from langchain_chroma import Chroma
from get_embedding_function import get_embedding_function
from pathlib import Path
import time
import string
from uploaded_data import Uploaded_data

# Queries the RAG with a given input
def query_rag(query_text: str, vector_database_directory):
    # Prepare the DB.
    start_time = time.time()
    embedding_function = get_embedding_function()
    end_time = time.time()
    print(f"Execution time for get_embedding_function is: {end_time - start_time:.6f} seconds")
    start_time = time.time()
    db_root = Path(__file__).resolve().parents[2] / 'storage' / 'db_store'
    full_db_path = db_root / vector_database_directory
    db = Chroma(persist_directory=str(full_db_path), embedding_function=embedding_function)
    end_time = time.time()
    print(f"Execution time for retrieving database is: {end_time - start_time:.6f} seconds")
    # Search the DB.
    start_time = time.time()
    results = db.similarity_search_with_score(query_text, k=4)
    end_time = time.time()
    print(f"Execution time for rag search is: {end_time - start_time:.6f} seconds")
    context_text = "\n\n---\n\n".join([doc.page_content for doc, _score in results])
    # Get sources of RAG query
    # sources = [doc.metadata.get("id", None) for doc, _score in results]
    sources = [doc.metadata.get("id", "").split("/")[-1] for doc, _score in results]
    formatted_sources = "\n".join(sources)
    sources_text = f"\n{formatted_sources}"
    return context_text, sources_text