from session import Session
from uploaded_data import Uploaded_data
from data_store import DataStore
import time
import subprocess
import logging
from pathlib import Path

# For testing purposes only
def main():
    """Starts the ollama serve process."""
    try:
        # Start the 'ollama serve' command in a new subprocess
        subprocess.Popen(['ollama', 'serve'], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        logging.info("Started ollama serve process.")
    except Exception as e:
        logging.error("Failed to start ollama serve: %s", str(e))

    root_dir = Path(__file__).parent.parent.parent  # Go up to project root
    storage_dir = root_dir / "storage"
    upload_dir = storage_dir / "uploads"
    uploaded_data_test = Uploaded_data("")
    session1 = Session(currently_used_data=[])
    query = ""
    print("How can I help you?")
    while query != "exit":
        query = input()
        start_time = time.time()
        for chunk in session1.ask(query):
            print(chunk, end="")
        print()
        end_time = time.time()
        print(f"Execution time for ask is: {end_time - start_time:.6f} seconds")
        if session1.num_exchanges == 1:
            session1.assign_session_summary()
if __name__ == "__main__":
    main()