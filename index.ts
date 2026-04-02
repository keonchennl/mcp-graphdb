#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
    CallToolRequestSchema,
    ListResourcesRequestSchema,
    ListToolsRequestSchema,
    ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fetch from "node-fetch";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

// Define types for SPARQL query results
interface SparqlBinding {
    [key: string]: {
        type: string;
        value: string;
        datatype?: string;
        "xml:lang"?: string;
    };
}

interface SparqlResults {
    head: {
        vars: string[];
        link?: string[];
    };
    results: {
        bindings: SparqlBinding[];
    };
}

const server = new Server(
    {
        name: "mcp-server-graphdb",
        version: "0.1.0",
    },
    {
        capabilities: {
            resources: {},
            tools: {},
        },
    },
);

// Get configuration from environment variables or command-line arguments
const args = process.argv.slice(2);
const endpoint = process.env.GRAPHDB_ENDPOINT || args[0] || "http://localhost:7200";
const repository = process.env.GRAPHDB_REPOSITORY || args[1] || "";
const username = process.env.GRAPHDB_USERNAME || "";
const password = process.env.GRAPHDB_PASSWORD || "";

if (!repository) {
    console.warn("No repository specified. Please set GRAPHDB_REPOSITORY environment variable or provide it as an argument.");
}

// Check if authentication credentials were provided
let hasAuth = false;
if (username && password) {
    hasAuth = true;
}

// Base URL for resources
const resourceBaseUrl = new URL(endpoint);
resourceBaseUrl.protocol = "graphdb:";

// Path constants
const REPOSITORY_PATH = "repository";
const GRAPH_PATH = "graph";
const CLASS_LIST_PATH = "classes";
const PREDICATES_PATH = "predicates";
const SAMPLE_DATA_PATH = "sample";
const STATS_PATH = "stats";

// Helper function to execute SPARQL queries
async function executeSparqlQuery(query: string, accept = "application/sparql-results+json"): Promise<SparqlResults> {
    const repositoryUrl = `${endpoint}/repositories/${repository}`;

    try {
        // Prepare headers
        const headers: Record<string, string> = {
            "Content-Type": "application/sparql-query",
            "Accept": accept,
        };

        // Add authentication if provided
        if (hasAuth) {
            const authString = Buffer.from(`${username}:${password}`).toString('base64');
            headers["Authorization"] = `Basic ${authString}`;
        }

        const response = await fetch(repositoryUrl, {
            method: "POST",
            headers,
            body: query,
        });

        if (!response.ok) {
            throw new Error(`GraphDB query failed: ${response.status} ${response.statusText}`);
        }

        return await response.json() as SparqlResults;
    } catch (error) {
        console.error("Error executing SPARQL query:", error);
        throw error;
    }
}

// Handler for listing resources (graphs in the repository)
server.setRequestHandler(ListResourcesRequestSchema, async () => {
    if (!repository) {
        return { resources: [] };
    }

    // Query to get all graphs in the repository
    const query = `
    SELECT DISTINCT ?graph
    WHERE {
      GRAPH ?graph { ?s ?p ?o }
    }
    ORDER BY ?graph
  `;

    try {
        const result = await executeSparqlQuery(query);
        const graphs = result.results.bindings.map((binding) => binding.graph.value);

        return {
            resources: [
                // Include repository info resources
                {
                    uri: new URL(`${REPOSITORY_PATH}/${repository}/${CLASS_LIST_PATH}`, resourceBaseUrl).href,
                    mimeType: "application/json",
                    name: `Repository '${repository}' class list`,
                },
                {
                    uri: new URL(`${REPOSITORY_PATH}/${repository}/${PREDICATES_PATH}`, resourceBaseUrl).href,
                    mimeType: "application/json",
                    name: `Repository '${repository}' predicates`,
                },
                {
                    uri: new URL(`${REPOSITORY_PATH}/${repository}/${STATS_PATH}`, resourceBaseUrl).href,
                    mimeType: "application/json",
                    name: `Repository '${repository}' statistics`,
                },
                {
                    uri: new URL(`${REPOSITORY_PATH}/${repository}/${SAMPLE_DATA_PATH}`, resourceBaseUrl).href,
                    mimeType: "application/json",
                    name: `Repository '${repository}' sample data`,
                },
                // Include each graph as a resource
                ...graphs.map((graph: string) => ({
                    uri: new URL(`${REPOSITORY_PATH}/${repository}/${GRAPH_PATH}/${encodeURIComponent(graph)}`, resourceBaseUrl).href,
                    mimeType: "application/json",
                    name: `Graph '${graph}'`,
                })),
            ],
        };
    } catch (error) {
        console.error("Error listing resources:", error);
        return { resources: [] };
    }
});

// Handler for reading resources
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const resourceUrl = new URL(request.params.uri);
    const pathComponents = resourceUrl.pathname.split("/");

    // Extract components from path
    let repoName = "";
    let graphUri = "";
    let resourceType = "";

    // Parse the URL path
    for (let i = 0; i < pathComponents.length; i++) {
        if (pathComponents[i] === REPOSITORY_PATH && i + 1 < pathComponents.length) {
            repoName = pathComponents[i + 1];
        } else if (pathComponents[i] === GRAPH_PATH && i + 1 < pathComponents.length) {
            graphUri = decodeURIComponent(pathComponents[i + 1]);
        } else if ([CLASS_LIST_PATH, PREDICATES_PATH, SAMPLE_DATA_PATH, STATS_PATH].includes(pathComponents[i])) {
            resourceType = pathComponents[i];
        }
    }

    if (!repoName) {
        throw new Error("Invalid resource URI: missing repository name");
    }

    try {
        if (resourceType === CLASS_LIST_PATH) {
            // Return list of classes
            const query = `
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
        PREFIX owl: <http://www.w3.org/2002/07/owl#>
        SELECT DISTINCT ?class ?label ?comment (COUNT(?instance) as ?count)
        WHERE {
          {
            ?class a rdfs:Class .
          } UNION {
            ?class a owl:Class .
          }
          OPTIONAL { ?instance a ?class }
          OPTIONAL { ?class rdfs:label ?label }
          OPTIONAL { ?class rdfs:comment ?comment }
        }
        GROUP BY ?class ?label ?comment
        ORDER BY DESC(?count)
      `;

            const result = await executeSparqlQuery(query);
            return {
                contents: [
                    {
                        uri: request.params.uri,
                        mimeType: "application/json",
                        text: JSON.stringify(result, null, 2),
                    },
                ],
            };
        } else if (resourceType === PREDICATES_PATH) {
            // Return list of predicates
            const query = `
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
        SELECT DISTINCT ?predicate ?label ?comment (COUNT(*) as ?usage)
        WHERE {
          ?s ?predicate ?o .
          OPTIONAL { ?predicate rdfs:label ?label }
          OPTIONAL { ?predicate rdfs:comment ?comment }
        }
        GROUP BY ?predicate ?label ?comment
        ORDER BY DESC(?usage)
        LIMIT 100
      `;

            const result = await executeSparqlQuery(query);
            return {
                contents: [
                    {
                        uri: request.params.uri,
                        mimeType: "application/json",
                        text: JSON.stringify(result, null, 2),
                    },
                ],
            };
        } else if (resourceType === STATS_PATH) {
            // Return repository statistics
            const query = `
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        SELECT 
          (COUNT(DISTINCT ?s) as ?subjects) 
          (COUNT(DISTINCT ?p) as ?predicates) 
          (COUNT(DISTINCT ?o) as ?objects)
          (COUNT(*) as ?triples)
        WHERE {
          ?s ?p ?o .
        }
      `;

            const result = await executeSparqlQuery(query);

            // Count graphs
            const graphQuery = `
        SELECT (COUNT(DISTINCT ?g) as ?graphs)
        WHERE {
          GRAPH ?g { ?s ?p ?o }
        }
      `;

            const graphResult = await executeSparqlQuery(graphQuery);

            // Combine results
            const combined = {
                statistics: {
                    ...result.results.bindings[0],
                    graphs: graphResult.results.bindings[0].graphs
                }
            };

            return {
                contents: [
                    {
                        uri: request.params.uri,
                        mimeType: "application/json",
                        text: JSON.stringify(combined, null, 2),
                    },
                ],
            };
        } else if (resourceType === SAMPLE_DATA_PATH) {
            // Return sample data
            const query = `
        SELECT ?subject ?predicate ?object
        WHERE {
          ?subject ?predicate ?object
        }
        LIMIT 50
      `;

            const result = await executeSparqlQuery(query);
            return {
                contents: [
                    {
                        uri: request.params.uri,
                        mimeType: "application/json",
                        text: JSON.stringify(result, null, 2),
                    },
                ],
            };
        } else if (graphUri) {
            // Query sample data from the graph
            const query = `
        SELECT ?subject ?predicate ?object
        FROM <${graphUri}>
        WHERE {
          ?subject ?predicate ?object
        }
        LIMIT 100
      `;

            const result = await executeSparqlQuery(query);

            // Get graph metadata
            const metadataQuery = `
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        SELECT (COUNT(*) as ?triples) (COUNT(DISTINCT ?s) as ?subjects) (COUNT(DISTINCT ?p) as ?predicates)
        FROM <${graphUri}>
        WHERE {
          ?s ?p ?o .
        }
      `;

            const metadataResult = await executeSparqlQuery(metadataQuery);

            // Get graph ontology classes if any
            const ontologyQuery = `
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
        PREFIX owl: <http://www.w3.org/2002/07/owl#>
        SELECT DISTINCT ?class
        FROM <${graphUri}>
        WHERE {
          {
            ?class a rdfs:Class .
          } UNION {
            ?class a owl:Class .
          }
        }
        LIMIT 20
      `;

            let ontologyResult;
            try {
                ontologyResult = await executeSparqlQuery(ontologyQuery);
            } catch (err) {
                ontologyResult = { results: { bindings: [] } };
            }

            // Combine results
            const combined = {
                sampleData: result.results.bindings,
                metadata: metadataResult.results.bindings[0],
                ontologyClasses: ontologyResult.results.bindings
            };

            return {
                contents: [
                    {
                        uri: request.params.uri,
                        mimeType: "application/json",
                        text: JSON.stringify(combined, null, 2),
                    },
                ],
            };
        }

        throw new Error("Invalid resource URI");
    } catch (error) {
        console.error("Error reading resource:", error);
        throw error;
    }
});

// Handler for listing tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: "sparqlQuery",
                description: "Execute a read-only SPARQL query against the GraphDB repository",
                inputSchema: {
                    type: "object",
                    properties: {
                        query: {
                            type: "string",
                            description: "The SPARQL query to execute"
                        },
                        graph: {
                            type: "string",
                            description: "Optional: Specific graph IRI to query"
                        },
                        format: {
                            type: "string",
                            description: "Optional: Response format (json, xml, csv)",
                            enum: ["json", "xml", "csv"],
                            default: "json"
                        }
                    },
                    required: ["query"]
                },
            },
            {
                name: "listGraphs",
                description: "List all graphs in the repository",
                inputSchema: {
                    type: "object",
                    properties: {}
                },
            }
        ],
    };
});

// Handler for calling tools
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name === "sparqlQuery") {
        const sparqlQuery = request.params.arguments?.query as string;
        const graph = request.params.arguments?.graph as string;
        const format = request.params.arguments?.format as string || "json";

        // Determine the accept header based on format
        let acceptHeader = "application/sparql-results+json";
        if (format === "xml") {
            acceptHeader = "application/sparql-results+xml";
        } else if (format === "csv") {
            acceptHeader = "text/csv";
        }

        // Modify query to include FROM clause if graph is specified
        let modifiedQuery = sparqlQuery;
        if (graph && !sparqlQuery.includes("FROM <") && !sparqlQuery.includes("GRAPH <")) {
            // Simple heuristic to add FROM clause - this is a basic approach
            const insertPoint = sparqlQuery.indexOf("WHERE");
            if (insertPoint > 0) {
                modifiedQuery =
                    sparqlQuery.substring(0, insertPoint) +
                    `FROM <${graph}> ` +
                    sparqlQuery.substring(insertPoint);
            }
        }

        try {
            // For non-JSON response formats, we need to handle the response differently
            if (format !== "json") {
                const repositoryUrl = `${endpoint}/repositories/${repository}`;

                // Prepare headers
                const headers: Record<string, string> = {
                    "Content-Type": "application/sparql-query",
                    "Accept": acceptHeader,
                };

                // Add authentication if provided
                if (hasAuth) {
                    const authString = Buffer.from(`${username}:${password}`).toString('base64');
                    headers["Authorization"] = `Basic ${authString}`;
                }

                const response = await fetch(repositoryUrl, {
                    method: "POST",
                    headers,
                    body: modifiedQuery,
                });

                if (!response.ok) {
                    throw new Error(`GraphDB query failed: ${response.status} ${response.statusText}`);
                }

                const textResult = await response.text();
                return {
                    content: [{ type: "text", text: textResult }],
                    isError: false,
                };
            } else {
                // For JSON, we use the typed function
                const result = await executeSparqlQuery(modifiedQuery, acceptHeader);
                return {
                    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
                    isError: false,
                };
            }
        } catch (error: any) {
            return {
                content: [{ type: "text", text: `Error executing query: ${error.message}` }],
                isError: true,
            };
        }
    } else if (request.params.name === "listGraphs") {
        // Query to get all graphs in the repository
        const query = `
      SELECT DISTINCT ?graph
      WHERE {
        GRAPH ?graph { ?s ?p ?o }
      }
      ORDER BY ?graph
    `;

        try {
            const result = await executeSparqlQuery(query);
            return {
                content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
                isError: false,
            };
        } catch (error: any) {
            return {
                content: [{ type: "text", text: `Error listing graphs: ${error.message}` }],
                isError: true,
            };
        }
    }

    throw new Error(`Unknown tool: ${request.params.name}`);
});


async function runServer() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
}

runServer().catch(console.error);
