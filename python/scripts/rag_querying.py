from langchain_chroma import Chroma
from get_embedding_function import get_embedding_function
from pathlib import Path
import time
import string
from uploaded_data import Uploaded_data

# Queries the RAG with a given input
def query_rag(query_text: str, vector_database_directory, k_value):
    # Prepare the DB.
    safe_query_text = query_text.replace('{', '{{').replace('}', '}}')
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
    results = db.similarity_search_with_score(safe_query_text, k=k_value)  # Retrieve top k chunks from each database
    end_time = time.time()
    print(f"Execution time for rag search is: {end_time - start_time:.6f} seconds")

    # Return the documents and their scores for further processing
    return results