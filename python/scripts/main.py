# python/main.py (was main.py)
import sys
import json
import os
from session import Session
from uploaded_data import Uploaded_data
from data_store import DataStore

# Initialize core objects (similar to your Flask app)
uploaded_data_store = DataStore("uploaded_data_store.pkl")
session = Session(currently_used_data=None)


def process_chat(message):
    """Handles chat messages (was your /chat route)"""
    try:
        for chunk in session.ask(message):
            print(json.dumps({"chunk": chunk}), flush=True)
    except Exception as e:
        print(json.dumps({"error": str(e)}), flush=True)


def handle_file_upload(filename, filepath):
    """Handles file uploads (was your /upload route)"""
    try:
        uploaded_data = Uploaded_data(filename, filepath)
        uploaded_data_store.add(uploaded_data)
        session.currently_used_data = uploaded_data
        return {"success": True}
    except Exception as e:
        return {"error": str(e)}


def handle_file_delete(filename):
    """Handles file deletion (was your /delete route)"""
    try:
        Uploaded_data.delete_vector_db(filename)
        return {"success": True}
    except Exception as e:
        return {"error": str(e)}


def handle_select_files(filenames):
    """Handles file selection (was your /select-files route)"""
    try:
        uploaded_data_list = []
        for filename in filenames:
            file_path = os.path.join('storage', 'uploads', filename)
            if os.path.exists(file_path):
                uploaded_data = Uploaded_data(filename, file_path)
                uploaded_data_list.append(uploaded_data)

        session.currently_used_data = uploaded_data_list
        return {"success": True}
    except Exception as e:
        return {"error": str(e)}


if __name__ == "__main__":
    # Get command and data from Node.js
    input_data = json.loads(sys.argv[1])
    command = input_data.get('command')
    data = input_data.get('data')

    # Route to appropriate handler
    if command == 'chat':
        process_chat(data['message'])
    elif command == 'upload':
        result = handle_file_upload(data['filename'], data['filepath'])
        print(json.dumps(result))
    elif command == 'delete':
        result = handle_file_delete(data['filename'])
        print(json.dumps(result))
    elif command == 'select':
        result = handle_select_files(data['filenames'])
        print(json.dumps(result))