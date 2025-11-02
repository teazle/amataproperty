#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError, } from '@modelcontextprotocol/sdk/types.js';
import { BedrockAgentRuntimeClient, RetrieveCommand } from '@aws-sdk/client-bedrock-agent-runtime';
// AWS Configuration
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';
const KNOWLEDGE_BASE_ID = process.env.KNOWLEDGE_BASE_ID || '';
// Initialize AWS Bedrock client
const bedrockClient = new BedrockAgentRuntimeClient({
    region: AWS_REGION,
});
// Create MCP server
const server = new Server({
    name: 'aws-knowledge-base-mcp',
    version: '0.1.0',
}, {
    capabilities: {
        tools: {},
    },
});
// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: 'retrieve_from_knowledge_base',
                description: 'Retrieve information from AWS Knowledge Base using semantic search',
                inputSchema: {
                    type: 'object',
                    properties: {
                        query: {
                            type: 'string',
                            description: 'The search query to retrieve relevant information',
                        },
                        knowledgeBaseId: {
                            type: 'string',
                            description: 'The AWS Knowledge Base ID to search in',
                        },
                        numberOfResults: {
                            type: 'number',
                            description: 'Number of results to retrieve (default: 5)',
                            default: 5,
                        },
                    },
                    required: ['query', 'knowledgeBaseId'],
                },
            },
            {
                name: 'search_aws_ccapi_resources',
                description: 'Search for AWS Cloud Control API resource information',
                inputSchema: {
                    type: 'object',
                    properties: {
                        resourceType: {
                            type: 'string',
                            description: 'AWS resource type (e.g., AWS::S3::Bucket, AWS::EC2::Instance)',
                        },
                        query: {
                            type: 'string',
                            description: 'Search query for resource documentation',
                        },
                    },
                    required: ['resourceType', 'query'],
                },
            },
        ],
    };
});
// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
        switch (name) {
            case 'retrieve_from_knowledge_base': {
                const { query, knowledgeBaseId, numberOfResults = 5 } = args;
                if (!query || !knowledgeBaseId) {
                    throw new McpError(ErrorCode.InvalidParams, 'Query and knowledgeBaseId are required');
                }
                const command = new RetrieveCommand({
                    knowledgeBaseId,
                    retrievalQuery: {
                        text: query,
                    },
                    retrievalConfiguration: {
                        vectorSearchConfiguration: {
                            numberOfResults,
                        },
                    },
                });
                const response = await bedrockClient.send(command);
                const results = response.retrievalResults?.map((result) => ({
                    content: result.content?.text || '',
                    score: result.score || 0,
                    location: result.location?.s3Location || null,
                    metadata: result.metadata || {},
                })) || [];
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                query,
                                knowledgeBaseId,
                                results,
                                totalResults: results.length,
                            }, null, 2),
                        },
                    ],
                };
            }
            case 'search_aws_ccapi_resources': {
                const { resourceType, query } = args;
                if (!resourceType || !query) {
                    throw new McpError(ErrorCode.InvalidParams, 'ResourceType and query are required');
                }
                // Search for AWS CCapi resource information in knowledge base
                const searchQuery = `AWS Cloud Control API ${resourceType} ${query}`;
                if (!KNOWLEDGE_BASE_ID) {
                    throw new McpError(ErrorCode.InternalError, 'KNOWLEDGE_BASE_ID environment variable is not set');
                }
                const command = new RetrieveCommand({
                    knowledgeBaseId: KNOWLEDGE_BASE_ID,
                    retrievalQuery: {
                        text: searchQuery,
                    },
                    retrievalConfiguration: {
                        vectorSearchConfiguration: {
                            numberOfResults: 3,
                        },
                    },
                });
                const response = await bedrockClient.send(command);
                const results = response.retrievalResults?.map((result) => ({
                    content: result.content?.text || '',
                    score: result.score || 0,
                    resourceType,
                    location: result.location?.s3Location || null,
                })) || [];
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                resourceType,
                                query: searchQuery,
                                results,
                                totalResults: results.length,
                            }, null, 2),
                        },
                    ],
                };
            }
            default:
                throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
        }
    }
    catch (error) {
        if (error instanceof McpError) {
            throw error;
        }
        throw new McpError(ErrorCode.InternalError, `Error executing tool ${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
});
// Start the server
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('AWS Knowledge Base MCP server running on stdio');
}
if (import.meta.main) {
    main().catch((error) => {
        console.error('Server error:', error);
        process.exit(1);
    });
}
export { server };
