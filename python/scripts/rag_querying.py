import os
from langchain_chroma import Chroma
from get_embedding_function import get_embedding_function
from pathlib import Path

def query_rag(query_text: str, vector_database_directory, k_value):
    safe_query_text = query_text.replace('{', '{{').replace('}', '}}')
    embedding_function = get_embedding_function()
    user_data_dir = Path(os.environ.get('ELECTRON_APP_DATA_DIR', '.'))
    db_root = user_data_dir / 'storage' / 'db_store'
    full_db_path = db_root / vector_database_directory
    db = Chroma(persist_directory=str(full_db_path), embedding_function=embedding_function)
    results = db.similarity_search_with_score(safe_query_text, k=k_value)
    return results
