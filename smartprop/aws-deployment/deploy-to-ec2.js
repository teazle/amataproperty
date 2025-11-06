#!/usr/bin/env node
/**
 * SmartProp AWS EC2 Deployment Script
 * Uses AWS MCP tools to automate EC2 provisioning and deployment
 */

import { spawn } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';

const CONFIG = {
  // EC2 Configuration
  instanceType: 't3.small',
  region: 'ap-southeast-1',
  keyPairName: 'smartprop-ec2-key',
  securityGroupName: 'smartprop-sg',
  
  // Application Configuration
  appName: 'smartprop',
  domain: process.env.DOMAIN || null, // If not set, will use EC2 public IP
  
  // Repository
  repoUrl: 'https://github.com/teazle/amataproperty.git',
  
  // Environment
  profile: 'new-profile'
};

// Helper: resolve path for files under aws-deployment whether invoked from repo root or smartprop/
function resolveAwsPath(subpath) {
  const direct = join(process.cwd(), 'aws-deployment', subpath);
  if (existsSync(direct)) return direct;
  return join(process.cwd(), 'smartprop', 'aws-deployment', subpath);
}

// Helper: resolve application root (directory containing Dockerfile)
function resolveAppRoot() {
  const cwdDocker = join(process.cwd(), 'Dockerfile');
  if (existsSync(cwdDocker)) return process.cwd();
  const nestedDocker = join(process.cwd(), 'smartprop', 'Dockerfile');
  if (existsSync(nestedDocker)) return join(process.cwd(), 'smartprop');
  throw new Error('Could not locate Dockerfile in current project. Run script from repo root or smartprop/.');
}

class EC2Deployer {
  constructor() {
    this.instanceId = null;
    this.publicIp = null;
  }

  async log(message) {
    console.log(`[${new Date().toISOString()}] ${message}`);
  }

  async runCommand(command, args = [], options = {}) {
    return new Promise((resolve, reject) => {
      const proc = spawn(command, args, { stdio: 'pipe', ...options });
      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(`Command failed: ${stderr}`));
        }
      });
    });
  }

  async checkAWSCredentials() {
    try {
      await this.log('Checking AWS credentials...');
      const result = await this.runCommand('aws', ['sts', 'get-caller-identity', '--profile', CONFIG.profile]);
      const identity = JSON.parse(result);
      await this.log(`✅ AWS credentials valid - Account: ${identity.Account}`);
      return true;
    } catch (error) {
      await this.log(`❌ AWS credentials check failed: ${error.message}`);
      return false;
    }
  }

  async createKeyPair() {
    try {
      await this.log('Creating EC2 key pair...');
      
      // Check if key pair already exists
      try {
        await this.runCommand('aws', [
          'ec2', 'describe-key-pairs',
          '--key-names', CONFIG.keyPairName,
          '--profile', CONFIG.profile,
          '--region', CONFIG.region
        ]);
        const pemPath = resolveAwsPath(`${CONFIG.keyPairName}.pem`);
        if (existsSync(pemPath)) {
          await this.log('✅ Key pair already exists');
          return true;
        } else {
          // Local PEM missing; create a new key pair with unique name
          const newName = `${CONFIG.keyPairName}-${Date.now()}`;
          await this.log(`Local key file missing. Creating new key pair: ${newName}`);
          CONFIG.keyPairName = newName;
        }
      } catch {
        // Key pair doesn't exist, create it
      }

      const result = await this.runCommand('aws', [
        'ec2', 'create-key-pair',
        '--key-name', CONFIG.keyPairName,
        '--profile', CONFIG.profile,
        '--region', CONFIG.region,
        '--output', 'json'
      ]);

      const keyPair = JSON.parse(result);
      
      // Save private key in aws-deployment directory
      const savePath = resolveAwsPath(`${CONFIG.keyPairName}.pem`);
      writeFileSync(savePath, keyPair.KeyMaterial);
      await this.runCommand('chmod', ['400', savePath]);
      
      await this.log('✅ Key pair created and saved');
      return true;
    } catch (error) {
      await this.log(`❌ Key pair creation failed: ${error.message}`);
      return false;
    }
  }

  async createSecurityGroup() {
    try {
      await this.log('Creating security group...');
      
      // Check if security group already exists
      try {
        const result = await this.runCommand('aws', [
          'ec2', 'describe-security-groups',
          '--group-names', CONFIG.securityGroupName,
          '--profile', CONFIG.profile,
          '--region', CONFIG.region
        ]);
        const sg = JSON.parse(result);
        await this.log(`✅ Security group already exists: ${sg.SecurityGroups[0].GroupId}`);
        return sg.SecurityGroups[0].GroupId;
      } catch {
        // Security group doesn't exist, create it
      }

      // Create security group
      const createResult = await this.runCommand('aws', [
        'ec2', 'create-security-group',
        '--group-name', CONFIG.securityGroupName,
        '--description', 'SmartProp application security group',
        '--profile', CONFIG.profile,
        '--region', CONFIG.region,
        '--output', 'json'
      ]);

      const sg = JSON.parse(createResult);
      const groupId = sg.GroupId;

      // Add inbound rules
      const rules = [
        { port: 22, description: 'SSH' },
        { port: 80, description: 'HTTP' },
        { port: 443, description: 'HTTPS' }
      ];

      for (const rule of rules) {
        await this.runCommand('aws', [
          'ec2', 'authorize-security-group-ingress',
          '--group-id', groupId,
          '--protocol', 'tcp',
          '--port', rule.port.toString(),
          '--cidr', '0.0.0.0/0',
          '--profile', CONFIG.profile,
          '--region', CONFIG.region
        ]);
      }

      await this.log(`✅ Security group created: ${groupId}`);
      return groupId;
    } catch (error) {
      await this.log(`❌ Security group creation failed: ${error.message}`);
      throw error;
    }
  }

  async findExistingInstance() {
    try {
      await this.log('Checking for existing EC2 instance with SmartProp tags...');

      const result = await this.runCommand('aws', [
        'ec2', 'describe-instances',
        '--profile', CONFIG.profile,
        '--region', CONFIG.region,
        '--filters',
        `Name=tag:Name,Values=${CONFIG.appName}-server`,
        'Name=instance-type,Values=' + CONFIG.instanceType,
        'Name=instance-state-name,Values=pending,running,stopping,stopped'
      ]);

      const data = JSON.parse(result);
      const instances = (data.Reservations || [])
        .flatMap(r => r.Instances || [])
        .filter(i => !!i.InstanceId);

      if (instances.length === 0) {
        await this.log('No existing instance found. Will launch a new one.');
        return null;
      }

      const running = instances.filter(i => i.State && i.State.Name === 'running');
      const chosen = (running[0]) || instances.sort((a, b) => (new Date(b.LaunchTime) - new Date(a.LaunchTime)))[0];

      this.instanceId = chosen.InstanceId;
      this.instanceKeyName = chosen.KeyName || null;

      const ipResult = await this.runCommand('aws', [
        'ec2', 'describe-instances',
        '--instance-ids', this.instanceId,
        '--query', 'Reservations[0].Instances[0].PublicIpAddress',
        '--output', 'text',
        '--profile', CONFIG.profile,
        '--region', CONFIG.region
      ]);

      this.publicIp = (ipResult || '').trim();
      await this.log(`Found existing instance: ${this.instanceId} (state: ${chosen.State?.Name}, ip: ${this.publicIp || 'none'})`);

      if (instances.length > 1) {
        const others = instances.map(i => i.InstanceId).filter(id => id !== this.instanceId);
        await this.log(`⚠️ Multiple instances detected (${instances.length}). Keeping ${this.instanceId}, others: ${others.join(', ')}`);
      }

      return this.instanceId;
    } catch (error) {
      await this.log(`Failed to check existing instances: ${error.message}`);
      return null;
    }
  }

  async launchEC2Instance(securityGroupId) {
    try {
      await this.log('Launching EC2 instance...');

      // Idempotency: reuse existing instance if present
      if (await this.findExistingInstance()) {
        // If local key file is missing or key pair mismatched, we cannot SSH; replace instance
        const pemPath = resolveAwsPath(`${CONFIG.keyPairName}.pem`);
        const hasLocalKey = existsSync(pemPath);
        const keyMismatch = this.instanceKeyName && this.instanceKeyName !== CONFIG.keyPairName;
        if (!hasLocalKey || keyMismatch) {
          await this.log('Local key file missing; terminating existing instance to relaunch with a new key pair.');
          await this.runCommand('aws', [
            'ec2', 'terminate-instances',
            '--instance-ids', this.instanceId,
            '--profile', CONFIG.profile,
            '--region', CONFIG.region
          ]);
          await this.runCommand('aws', [
            'ec2', 'wait', 'instance-terminated',
            '--instance-ids', this.instanceId,
            '--profile', CONFIG.profile,
            '--region', CONFIG.region
          ]);
          await this.log('Existing instance terminated. Proceeding to launch a new instance...');
        } else {
          if (this.publicIp) {
            await this.log('Reusing existing instance; skipping launch.');
            return this.instanceId;
          }
          await this.log('Existing instance found without public IP; ensuring it is running...');
          await this.runCommand('aws', [
            'ec2', 'start-instances',
            '--instance-ids', this.instanceId,
            '--profile', CONFIG.profile,
            '--region', CONFIG.region
          ]);
          await this.runCommand('aws', [
            'ec2', 'wait', 'instance-running',
            '--instance-ids', this.instanceId,
            '--profile', CONFIG.profile,
            '--region', CONFIG.region
          ]);
          const describeResult = await this.runCommand('aws', [
            'ec2', 'describe-instances',
            '--instance-ids', this.instanceId,
            '--query', 'Reservations[0].Instances[0].PublicIpAddress',
            '--output', 'text',
            '--profile', CONFIG.profile,
            '--region', CONFIG.region
          ]);
          this.publicIp = describeResult.trim();
          await this.log(`✅ Instance running at: ${this.publicIp}`);
          return this.instanceId;
        }
      }

      // Get latest Ubuntu 22.04 AMI
      const amiResult = await this.runCommand('aws', [
        'ec2', 'describe-images',
        '--owners', '099720109477', // Canonical
        '--filters',
        'Name=name,Values=ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*',
        'Name=state,Values=available',
        '--query', 'Images | sort_by(@, &CreationDate) | [-1].ImageId',
        '--output', 'text',
        '--profile', CONFIG.profile,
        '--region', CONFIG.region
      ]);

      const amiId = amiResult.trim();
      await this.log(`Using AMI: ${amiId}`);

      // Launch instance
      const launchResult = await this.runCommand('aws', [
        'ec2', 'run-instances',
        '--image-id', amiId,
        '--count', '1',
        '--instance-type', CONFIG.instanceType,
        '--key-name', CONFIG.keyPairName,
        '--security-group-ids', securityGroupId,
        '--tag-specifications', `ResourceType=instance,Tags=[{Key=Name,Value=${CONFIG.appName}-server},{Key=Environment,Value=production}]`,
        '--block-device-mappings', '[{"DeviceName":"/dev/sda1","Ebs":{"VolumeSize":30}}]',
        '--profile', CONFIG.profile,
        '--region', CONFIG.region,
        '--output', 'json'
      ]);

      const launch = JSON.parse(launchResult);
      this.instanceId = launch.Instances[0].InstanceId;

      await this.log(`✅ Instance launched: ${this.instanceId}`);
      await this.log('Waiting for instance to be running...');

      // Wait for instance to be running
      await this.runCommand('aws', [
        'ec2', 'wait', 'instance-running',
        '--instance-ids', this.instanceId,
        '--profile', CONFIG.profile,
        '--region', CONFIG.region
      ]);

      // Get public IP
      const describeResult = await this.runCommand('aws', [
        'ec2', 'describe-instances',
        '--instance-ids', this.instanceId,
        '--query', 'Reservations[0].Instances[0].PublicIpAddress',
        '--output', 'text',
        '--profile', CONFIG.profile,
        '--region', CONFIG.region
      ]);

      this.publicIp = describeResult.trim();
      await this.log(`✅ Instance running at: ${this.publicIp}`);

      return this.instanceId;
    } catch (error) {
      await this.log(`❌ Instance launch failed: ${error.message}`);
      throw error;
    }
  }

  async cleanupDuplicateInstances() {
    if (!process.env.CLEANUP_DUPLICATES || process.env.CLEANUP_DUPLICATES !== 'true') {
      await this.log('Duplicate cleanup skipped (set CLEANUP_DUPLICATES=true to enable).');
      return;
    }

    try {
      await this.log('Looking for duplicate instances to terminate...');
      const result = await this.runCommand('aws', [
        'ec2', 'describe-instances',
        '--profile', CONFIG.profile,
        '--region', CONFIG.region,
        '--filters',
        `Name=tag:Name,Values=${CONFIG.appName}-server`,
        'Name=instance-type,Values=' + CONFIG.instanceType,
        'Name=instance-state-name,Values=pending,running,stopping,stopped'
      ]);

      const data = JSON.parse(result);
      const instances = (data.Reservations || [])
        .flatMap(r => r.Instances || [])
        .map(i => i.InstanceId);

      const toTerminate = instances.filter(id => id !== this.instanceId);
      if (toTerminate.length === 0) {
        await this.log('No duplicates found to terminate.');
        return;
      }

      await this.log(`Terminating duplicate instances: ${toTerminate.join(', ')}`);
      await this.runCommand('aws', [
        'ec2', 'terminate-instances',
        '--instance-ids', ...toTerminate,
        '--profile', CONFIG.profile,
        '--region', CONFIG.region
      ]);
      await this.log('✅ Duplicate instances termination initiated.');
    } catch (error) {
      await this.log(`Duplicate cleanup failed: ${error.message}`);
    }
  }

  async setupInstance() {
    try {
      await this.log('Setting up instance (this may take a few minutes)...');
      
      // Wait a bit for SSH to be ready
      await new Promise(resolve => setTimeout(resolve, 30000));

      // Copy setup script
      await this.runCommand('scp', [
        '-i', resolveAwsPath(`${CONFIG.keyPairName}.pem`),
        '-o', 'StrictHostKeyChecking=no',
        resolveAwsPath('ec2-setup.sh'),
        `ubuntu@${this.publicIp}:~/setup.sh`
      ]);

      // Run setup script
      await this.runCommand('ssh', [
        '-i', resolveAwsPath(`${CONFIG.keyPairName}.pem`),
        '-o', 'StrictHostKeyChecking=no',
        `ubuntu@${this.publicIp}`,
        'chmod +x ~/setup.sh && sudo ~/setup.sh'
      ]);

      await this.log('✅ Instance setup completed');
    } catch (error) {
      await this.log(`❌ Instance setup failed: ${error.message}`);
      throw error;
    }
  }

  async deployApplication() {
    try {
      await this.log('Deploying application...');

      // Create environment file
      const envContent = this.generateEnvFile();
      writeFileSync('.env.production', envContent);

      await this.log('Syncing application files to EC2...');
      const appRoot = resolveAppRoot();
      const rsyncArgs = [
        '-avz',
        '--delete',
        `-e`, `ssh -i ${resolveAwsPath(`${CONFIG.keyPairName}.pem`)} -o StrictHostKeyChecking=no`,
        '--exclude', '.git',
        '--exclude', 'node_modules',
        '--exclude', '.next',
        '--exclude', 'aws-deployment',
        `${appRoot}/`,
        `ubuntu@${this.publicIp}:/opt/smartprop/app/`
      ];
      await this.runCommand('rsync', rsyncArgs);

      // Copy files to server
      const filesToCopy = [
        resolveAwsPath('docker-compose.ec2.yml'),
        resolveAwsPath('nginx-ec2.conf'),
        join(process.cwd(), '.env.production'),
      ];

      for (const file of filesToCopy) {
        if (existsSync(file)) {
          await this.runCommand('scp', [
            '-i', resolveAwsPath(`${CONFIG.keyPairName}.pem`),
            '-o', 'StrictHostKeyChecking=no',
            file,
            `ubuntu@${this.publicIp}:/opt/smartprop/`
          ]);
        }
      }

      // Deploy using copied sources (no git clone dependency)
      const deployCommands = [
        'cd /opt/smartprop',
        'cp docker-compose.ec2.yml app/docker-compose.prod.yml',
        'cp .env.production app/.env',
        'cd /opt/smartprop/app',
        'mkdir -p /opt/smartprop/{storage,logs,waha-sessions,waha-files}',
        'sudo docker compose -f docker-compose.prod.yml --progress plain build --no-cache',
        'sudo docker-compose -f docker-compose.prod.yml up -d',
        'sudo systemctl start smartprop'
      ];

      await this.runCommand('ssh', [
        '-i', resolveAwsPath(`${CONFIG.keyPairName}.pem`),
        '-o', 'StrictHostKeyChecking=no',
        `ubuntu@${this.publicIp}`,
        deployCommands.join(' && ')
      ]);

      // Cleanup local tarball
      try { await this.runCommand('rm', ['-f', tarballPath]); } catch {}

      await this.log('✅ Application deployed successfully');
    } catch (error) {
      await this.log(`❌ Application deployment failed: ${error.message}`);
      throw error;
    }
  }

  generateEnvFile() {
    const baseUrl = CONFIG.domain ? `https://${CONFIG.domain}` : (this.publicIp ? `http://${this.publicIp}` : '');
    return `# Production Environment Variables
NODE_ENV=production
PUBLIC_BASE_URL=${baseUrl}

# Supabase (Update these with your values)
SUPABASE_URL=${process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'your_supabase_url'}
NEXT_PUBLIC_SUPABASE_URL=${process.env.NEXT_PUBLIC_SUPABASE_URL || 'your_supabase_url'}
NEXT_PUBLIC_SUPABASE_ANON_KEY=${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'your_anon_key'}
SUPABASE_SERVICE_ROLE=${process.env.SUPABASE_SERVICE_ROLE || 'your_service_role'}

# WAHA Configuration
WAHA_URL=http://waha:3030
WAHA_DASHBOARD_USERNAME=admin
WAHA_DASHBOARD_PASSWORD=${process.env.WAHA_DASHBOARD_PASSWORD || 'change-this-password'}

# Groq AI
GROQ_API_KEY=${process.env.GROQ_API_KEY || 'your_groq_key'}

# Buyer Agent Profile
BUYER_AGENT_NAME=${process.env.BUYER_AGENT_NAME || 'Jeremy'}
BUYER_AGENT_CEA_REG=${process.env.BUYER_AGENT_CEA_REG || 'R012345A'}
BUYER_AGENT_AVAILABILITY=${process.env.BUYER_AGENT_AVAILABILITY || 'Monday to Friday 8pm to 10pm'}

# Scraper Configuration
HEADLESS=true
PG_MAX_PAGES=3
EP_MAX_PAGES=3
PG_EMAIL=${process.env.PG_EMAIL || ''}
PG_PASSWORD=${process.env.PG_PASSWORD || ''}
EP_EMAIL=${process.env.EP_EMAIL || ''}
EP_PASSWORD=${process.env.EP_PASSWORD || ''}

# Features
ENABLE_TYPING_SIMULATION=true
`;
  }

  async deploy() {
    try {
      await this.log('🚀 Starting SmartProp deployment to AWS EC2...');

      // Step 1: Check AWS credentials
      if (!(await this.checkAWSCredentials())) {
        throw new Error('AWS credentials not configured');
      }

      // Step 2: Create key pair
      await this.createKeyPair();

      // Step 3: Create security group
      const securityGroupId = await this.createSecurityGroup();

      // Step 4: Launch EC2 instance
      await this.launchEC2Instance(securityGroupId);

      // Step 5: Setup instance
      await this.setupInstance();

      // Step 6: Deploy application
      await this.deployApplication();

      // Optional: Clean up duplicates to control costs
      await this.cleanupDuplicateInstances();

      await this.log('🎉 Deployment completed successfully!');
      await this.log('');
      await this.log('Next steps:');
      await this.log(`1. Point your domain ${CONFIG.domain} to ${this.publicIp}`);
      await this.log(`2. SSH into server: ssh -i $(pwd)/smartprop/aws-deployment/${CONFIG.keyPairName}.pem ubuntu@${this.publicIp}`);
      await this.log(`3. Setup SSL: sudo certbot --nginx -d ${CONFIG.domain}`);
      await this.log(`4. Access WAHA dashboard: https://${CONFIG.domain}/waha/`);
      await this.log('');
      await this.log(`Instance ID: ${this.instanceId}`);
      await this.log(`Public IP: ${this.publicIp}`);

    } catch (error) {
      await this.log(`❌ Deployment failed: ${error.message}`);
      process.exit(1);
    }
  }
}

// Run deployment
const deployer = new EC2Deployer();
deployer.deploy();