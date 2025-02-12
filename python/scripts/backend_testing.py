from session import Session
from uploaded_data import Uploaded_data
from data_store import DataStore
import time
import subprocess
import logging

# For testing purposes only
def main():
    """Starts the ollama serve process."""
    try:
        # Start the 'ollama serve' command in a new subprocess
        subprocess.Popen(['ollama', 'serve'], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        logging.info("Started ollama serve process.")
    except Exception as e:
        logging.error("Failed to start ollama serve: %s", str(e))

    uploaded_data_store = DataStore("uploaded_data_store.pkl")
    session_store = DataStore("session_store.pkl")
    # uploaded_data = None
    # currently_used_data_list = []
    # uploaded_data = Uploaded_data("HAI_AI-Index-Report-2024.pdf", 'data/HAI_AI-Index-Report-2024.pdf')
    # uploaded_data_store.add(uploaded_data)
    # currently_used_data_list.append(uploaded_data)
    # uploaded_data = Uploaded_data("coundouriotis00902 copy.pdf", 'data/coundouriotis00902 copy.pdf')
    # uploaded_data_store.add(uploaded_data)
    # currently_used_data_list.append(uploaded_data)
    session1 = Session(currently_used_data=None)
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
    session_store.add(session1)
    uploaded_data_store.save()
    session_store.save()
if __name__ == "__main__":
    main()