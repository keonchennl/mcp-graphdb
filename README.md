[![MseeP.ai Security Assessment Badge](https://mseep.net/pr/keonchennl-mcp-graphdb-badge.png)](https://mseep.ai/app/keonchennl-mcp-graphdb)

# GraphDB MCP Server

A Model Context Protocol server that provides read-only access to Ontotext GraphDB. This server enables LLMs to explore RDF graphs and execute SPARQL queries against a GraphDB instance.

## Components

### Tools

- **sparqlQuery**
  - Execute SPARQL queries against the connected GraphDB repository
  - Input:
    - `query` (string): The SPARQL query to execute
    - `graph` (string, optional): Specific graph IRI to target
    - `format` (string, optional): Response format (json, xml, csv)
  - All queries are executed in read-only mode

- **listGraphs**
  - Lists all graphs available in the repository
  - No input parameters required

### Resources

The server provides multiple views of the repository data:

- **Class List** (`graphdb://<host>/repository/<repo>/classes`)
  - Lists all RDF classes found in the repository with counts

- **Predicates** (`graphdb://<host>/repository/<repo>/predicates`)
  - Lists all predicates (properties) with usage counts

- **Statistics** (`graphdb://<host>/repository/<repo>/stats`)
  - Provides counts of subjects, predicates, objects, and triples

- **Sample Data** (`graphdb://<host>/repository/<repo>/sample`)
  - Shows a sample of triples from the repository

- **Graph Content** (`graphdb://<host>/repository/<repo>/graph/<graphUri>`)
  - Provides sample data from specific graphs along with metadata

## Configuration

You can configure the server using environment variables by creating a `.env` file:

```
GRAPHDB_ENDPOINT=http://localhost:7200
GRAPHDB_REPOSITORY=myRepository
GRAPHDB_USERNAME=username
GRAPHDB_PASSWORD=password
```

Alternatively, you can provide the endpoint and repository as command-line arguments:

```
node dist/index.js http://localhost:7200 myRepository
```

The command-line arguments take precedence over environment variables.

## Usage with Claude Desktop

To use this server with the Claude Desktop app, add the following configuration to the "mcpServers" section of your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "graphdb": {
      "command": "node",
      "args": [
        "/path/to/mcp-server-graphdb/dist/index.js"
      ],
      "env": {
        "GRAPHDB_ENDPOINT": "http://localhost:7200",
        "GRAPHDB_REPOSITORY": "myRepository",
        "GRAPHDB_USERNAME": "username",
        "GRAPHDB_PASSWORD": "password"
      }
    }
  }
}
```

Replace the values with your specific GraphDB configuration.

## Installation

```sh
# Clone the repository
git clone https://github.com/yourname/mcp-server-graphdb.git
cd mcp-server-graphdb

# Install dependencies
yarn install

# Build the project
yarn build
```

## Example SPARQL Queries

Here are some example SPARQL queries you can run with this server:

1. List all classes in the ontology:
```sparql
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
SELECT DISTINCT ?class ?label
WHERE {
  { ?class a rdfs:Class } UNION { ?class a owl:Class }
  OPTIONAL { ?class rdfs:label ?label }
}
ORDER BY ?class
```

2. List all properties for a specific class:
```sparql
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
SELECT ?property ?label ?range
WHERE {
  ?property rdfs:domain <http://example.org/YourClass> .
  OPTIONAL { ?property rdfs:label ?label }
  OPTIONAL { ?property rdfs:range ?range }
}
ORDER BY ?property
```

3. Count instances by class:
```sparql
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
SELECT ?class (COUNT(?instance) AS ?count)
WHERE {
  ?instance a ?class
}
GROUP BY ?class
ORDER BY DESC(?count)
```

## License

This MCP server is licensed under the MIT License. This means you are free to use, modify, and distribute the software, subject to the terms and conditions of the MIT License.