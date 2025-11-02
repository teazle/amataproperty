# AWS MCP Servers Setup

## Overview

This document covers the setup and configuration of AWS MCP servers that enable natural language interaction with AWS resources through the Model Context Protocol (MCP). We have configured two complementary AWS MCP servers:

1. **AWS Cloud Control API (CCAPI) MCP Server**: Provides high-level resource management with security scanning and transparency
2. **AWS API MCP Server**: Provides direct access to AWS APIs for more granular control

Both integrations allow you to manage AWS resources using conversational AI while maintaining security and transparency.

## Features

### AWS CCAPI MCP Server
- **Resource Management**: Create, Read, Update, Delete, and List (CRUDL) operations on AWS resources
- **Schema Information**: Get detailed schema information for AWS resource types
- **Natural Language Interface**: Interact with AWS services using natural language
- **Template Generation**: Generate CloudFormation and other AWS templates
- **Security**: Token-based workflow with transparency and audit trails

### AWS API MCP Server
- **Direct API Access**: Direct access to all AWS service APIs
- **Comprehensive Coverage**: Access to the full range of AWS services and operations
- **Real-time Operations**: Immediate execution of AWS API calls
- **Flexible Parameters**: Support for all AWS API parameters and options
- **Service Discovery**: Automatic discovery of available AWS services and operations

## Prerequisites

✅ **Already Configured:**
- AWS CLI installed and configured
- `uv` package manager installed
- MCP configuration file exists

## Configuration

### 1. MCP Server Configuration

Both AWS MCP servers have been added to your `.cursor/mcp.json` configuration:

```json
{
  "mcpServers": {
    "supabase-propertydemo": {
      "command": "npx",
      "args": ["-y", "@supabase/mcp-server-supabase@latest", "--project-ref", "pfdsmpfgwbbeijdzevpu"],
      "env": {
        "SUPABASE_ACCESS_TOKEN": "sbp_73904a875bbc63a37cc1ee6b00c085e026717932"
      }
    },
    "aws-ccapi-mcp-server": {
      "command": "uvx",
      "args": ["awslabs.ccapi-mcp-server@latest"],
      "env": {
        "AWS_PROFILE": "new-profile",
        "AWS_REGION": "ap-southeast-1",
        "DEFAULT_TAGS": "enabled",
        "SECURITY_SCANNING": "enabled",
        "FASTMCP_LOG_LEVEL": "ERROR"
      },
      "disabled": false,
      "autoApprove": []
    },
    "aws-api-mcp-server": {
      "command": "uvx",
      "args": ["awslabs.aws-api-mcp-server@latest"],
      "env": {
        "AWS_PROFILE": "new-profile",
        "AWS_REGION": "ap-southeast-1",
        "FASTMCP_LOG_LEVEL": "ERROR"
      },
      "disabled": false,
      "autoApprove": []
    }
  }
}
```

### 2. Environment Variables

#### AWS CCAPI MCP Server
| Variable | Value | Description |
|----------|-------|-------------|
| `AWS_PROFILE` | `new-profile` | AWS profile to use for authentication |
| `AWS_REGION` | `ap-southeast-1` | Default AWS region for operations |
| `DEFAULT_TAGS` | `enabled` | Enable default resource tagging |
| `SECURITY_SCANNING` | `enabled` | Enable security scanning of operations |
| `FASTMCP_LOG_LEVEL` | `ERROR` | Set logging level to reduce noise |

#### AWS API MCP Server
| Variable | Value | Description |
|----------|-------|-------------|
| `AWS_PROFILE` | `new-profile` | AWS profile to use for authentication |
| `AWS_REGION` | `ap-southeast-1` | Default AWS region for operations |
| `FASTMCP_LOG_LEVEL` | `ERROR` | Set logging level to reduce noise |

### 3. AWS Credentials Setup

Ensure your AWS credentials are properly configured:

```bash
# Check current configuration
aws configure list

# Configure if needed
aws configure

# Test credentials (refresh if expired)
aws sts get-caller-identity
```

**Note:** If you see "InvalidClientTokenId" errors, your AWS credentials may have expired. Refresh them using your organization's credential provider.

## Usage

### Starting the Servers

Both MCP servers will automatically start when you restart your IDE. The servers run in the background and communicate through the MCP protocol.

### Available Operations

#### AWS CCAPI MCP Server Operations
1. **Resource Management**
   - Create AWS resources (EC2 instances, S3 buckets, etc.)
   - Read resource configurations and status
   - Update resource properties
   - Delete resources
   - List resources by type or region

2. **Schema Operations**
   - Get resource type schemas
   - Validate resource configurations
   - Generate resource templates

#### AWS API MCP Server Operations
1. **Direct API Access**
   - Execute any AWS API operation directly
   - Access all AWS service endpoints
   - Real-time API calls with immediate responses

2. **Service Discovery**
   - List available AWS services
   - Discover service operations and parameters
   - Get API documentation and examples

### Example Commands

#### Using AWS CCAPI MCP Server
```
"Create an S3 bucket named 'my-app-storage' with versioning enabled"
"List all EC2 instances in the us-east-1 region"
"Generate a CloudFormation template for a basic VPC setup"
```

#### Using AWS API MCP Server
```
"Call the EC2 DescribeInstances API to get instance details"
"Execute S3 ListBuckets operation"
"Use CloudFormation CreateStack API with the provided template"
```

3. **Security Features**
   - All operations require explicit confirmation
   - Security scanning before execution
   - Audit trail of all operations
   - Read-only mode available

### Example Interactions

```
# Natural language examples you can use:

"Create an S3 bucket named 'my-property-data' in ap-southeast-1"

"List all EC2 instances in my account"

"Show me the schema for AWS::S3::Bucket"

"Create a Lambda function for processing property data"

"Delete the test EC2 instance i-1234567890abcdef0"
```

## Security

### Token-Based Workflow

The server uses a secure token-based workflow:

1. **Transparency**: All operations are clearly described before execution
2. **Security Scanning**: Operations are scanned for potential security issues
3. **Informed Consent**: You must approve each operation
4. **Audit Trail**: All operations are logged for review

### Security Protections

- **Credential Awareness**: Server is aware of AWS credential boundaries
- **Deletion Safeguards**: Extra confirmation required for destructive operations
- **Policy Restrictions**: Operations respect IAM policies and permissions
- **Read-Only Mode**: Available via `--readonly` flag for safe exploration

### IAM Permissions

Ensure your AWS credentials have appropriate permissions for the resources you want to manage. The server respects all IAM policies and will fail gracefully if permissions are insufficient.

## Troubleshooting

### Common Issues

1. **"InvalidClientTokenId" Error**
   - **Cause**: Expired AWS credentials
   - **Solution**: Refresh your AWS credentials through your organization's method

2. **"uvx command not found"**
   - **Cause**: `uv` package manager not installed
   - **Solution**: Install uv: `curl -LsSf https://astral.sh/uv/install.sh | sh`

3. **MCP Server Not Loading**
   - **Cause**: Configuration error or missing dependencies
   - **Solution**: Restart IDE, check `.cursor/mcp.json` syntax

4. **Permission Denied Errors**
   - **Cause**: Insufficient IAM permissions
   - **Solution**: Contact AWS administrator to grant necessary permissions

### Testing the Setup

Run the test script to verify everything is working:

```bash
node test-aws-ccapi-mcp.js
```

Expected output:
- ✅ AWS CCAPI MCP server is available and working
- ✅ AWS CCAPI MCP server found in configuration
- ✅ AWS credentials are configured correctly (if not expired)

## Advanced Configuration

### Read-Only Mode

For safe exploration, you can enable read-only mode:

```json
{
  "aws-ccapi-mcp-server": {
    "command": "uvx",
    "args": ["awslabs.ccapi-mcp-server@latest", "--readonly"],
    // ... rest of configuration
  }
}
```

### Custom Logging

Adjust logging levels for debugging:

```json
{
  "env": {
    "FASTMCP_LOG_LEVEL": "DEBUG"  // Options: DEBUG, INFO, WARNING, ERROR
  }
}
```

### Region-Specific Configuration

Set default region in your AWS profile or environment:

```bash
export AWS_DEFAULT_REGION=ap-southeast-1
```

## Integration with Existing Setup

The AWS CCAPI MCP server works alongside your existing Supabase MCP server. Both servers are available simultaneously, allowing you to:

- Manage AWS infrastructure for your property application
- Use Supabase for database operations
- Coordinate between AWS and Supabase resources
- Build comprehensive property management solutions

## Next Steps

1. **Restart your IDE** to load the new MCP server
2. **Test basic operations** with simple AWS resource queries
3. **Explore resource schemas** to understand available properties
4. **Integrate with your property application** by managing AWS resources that support your Supabase database

## Support

- **AWS CCAPI MCP Server**: [GitHub Repository](https://github.com/awslabs/ccapi-mcp-server)
- **Model Context Protocol**: [MCP Documentation](https://modelcontextprotocol.io/)
- **AWS Cloud Control API**: [AWS Documentation](https://docs.aws.amazon.com/cloudcontrolapi/)

---

*This setup enables powerful AWS resource management through natural language while maintaining security and transparency. The server integrates seamlessly with your existing development workflow.*