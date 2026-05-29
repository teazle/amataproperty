#!/usr/bin/env node
/**
 * SmartProp AWS EC2 Deployment Script
 * Uses AWS MCP tools to automate EC2 provisioning and deployment
 */

import { spawn } from 'child_process';
import { existsSync,writeFileSync } from 'fs';

const CONFIG = {
  // EC2 Configuration
  instanceType: 't3.small',
  region: 'ap-southeast-1',
  keyPairName: 'smartprop-ec2-key',
  securityGroupName: 'smartprop-sg',
  
  // Application Configuration
  appName: 'smartprop',
  domain: null, // No domain yet - will use EC2 public IP
  
  // Repository
  repoUrl: 'https://github.com/teazle/amataproperty.git',
  
  // Environment
  profile: 'new-profile'
};

class EC2Deployer {
  constructor() {
    this.instanceId = null;
    this.publicIp = null;
  }

  async log(message) {
    console.log(`[${new Date().toISOString()}] ${message}`);
  }

  async runCommand(command, args = []) {
    return new Promise((resolve, reject) => {
      const proc = spawn(command, args, { stdio: 'pipe' });
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
        await this.log('✅ Key pair already exists');
        return true;
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
      
      // Save private key
      writeFileSync(`${CONFIG.keyPairName}.pem`, keyPair.KeyMaterial);
      await this.runCommand('chmod', ['400', `${CONFIG.keyPairName}.pem`]);
      
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

  async launchEC2Instance(securityGroupId) {
    try {
      await this.log('Launching EC2 instance...');

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

  async setupInstance() {
    try {
      await this.log('Setting up instance (this may take a few minutes)...');
      
      // Wait a bit for SSH to be ready
      await new Promise(resolve => setTimeout(resolve, 30000));

      // Copy setup script
      await this.runCommand('scp', [
        '-i', `${CONFIG.keyPairName}.pem`,
        '-o', 'StrictHostKeyChecking=no',
        './ec2-setup.sh',
        `ubuntu@${this.publicIp}:~/setup.sh`
      ]);

      // Run setup script
      await this.runCommand('ssh', [
        '-i', `${CONFIG.keyPairName}.pem`,
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

      // Copy files to server
      const filesToCopy = [
        './docker-compose.ec2.yml',
        './nginx-ec2.conf',
        '.env.production'
      ];

      for (const file of filesToCopy) {
        if (existsSync(file)) {
          await this.runCommand('scp', [
            '-i', `${CONFIG.keyPairName}.pem`,
            '-o', 'StrictHostKeyChecking=no',
            file,
            `ubuntu@${this.publicIp}:/opt/smartprop/`
          ]);
        }
      }

      // Clone repository and deploy
      const deployCommands = [
        'cd /opt/smartprop',
        `git clone ${CONFIG.repoUrl} app || (cd app && git pull)`,
        'cd app',
        'cp ../docker-compose.ec2.yml docker-compose.prod.yml',
        'cp ../.env.production .env',
        'mkdir -p /opt/smartprop/{storage,logs,waha-sessions,waha-files}',
        'docker-compose -f docker-compose.prod.yml build',
        'docker-compose -f docker-compose.prod.yml up -d',
        'sudo systemctl start smartprop'
      ];

      await this.runCommand('ssh', [
        '-i', `${CONFIG.keyPairName}.pem`,
        '-o', 'StrictHostKeyChecking=no',
        `ubuntu@${this.publicIp}`,
        deployCommands.join(' && ')
      ]);

      await this.log('✅ Application deployed successfully');
    } catch (error) {
      await this.log(`❌ Application deployment failed: ${error.message}`);
      throw error;
    }
  }

  generateEnvFile() {
    return `# Production Environment Variables
NODE_ENV=production
PUBLIC_BASE_URL=https://${CONFIG.domain}

# Supabase (Update these with your values)
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

      await this.log('🎉 Deployment completed successfully!');
      await this.log('');
      await this.log('Next steps:');
      await this.log(`1. Point your domain ${CONFIG.domain} to ${this.publicIp}`);
      await this.log(`2. SSH into server: ssh -i ${CONFIG.keyPairName}.pem ubuntu@${this.publicIp}`);
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