from langchain_ollama import OllamaEmbeddings


def get_embedding_function():
    # Takes about 60 seconds to create vector db for a 500 page doc
    # embeddings = OllamaEmbeddings(model="nomic-embed-text")
    # Takes about 25 seconds to create vector db for a 500 page doc
    embeddings = OllamaEmbeddings(model="all-minilm")
    # embeddings = OllamaEmbeddings(model="snowflake-arctic-embed:22m")
    return embeddings