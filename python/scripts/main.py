import sys
import json
from session import Session
from uploaded_data import Uploaded_data
from data_store import DataStore

class PythonServer:
    def __init__(self):
        self.uploaded_data_store = DataStore("uploaded_data_store.pkl")
        self.session = Session(currently_used_data=None)

    def handle_ping(self, request_id):
        """Handle ping command to verify connection"""
        print(json.dumps({
            "requestId": request_id,
            "success": True,
            "done": True
        }), flush=True)

    def process_chat(self, message, request_id):
        try:
            for chunk in self.session.ask(message):
                print(json.dumps({
                    "requestId": request_id,
                    "chunk": chunk
                }), flush=True)
            print(json.dumps({
                "requestId": request_id,
                "done": True
            }), flush=True)
        except Exception as e:
            print(json.dumps({
                "requestId": request_id,
                "error": str(e)
            }), flush=True)

    def run(self):
        while True:
            try:
                line = sys.stdin.readline()
                if not line:
                    break

                data = json.loads(line)
                request_id = data.get('requestId')
                command = data.get('command')
                payload = data.get('data', {})

                if command == 'ping':
                    self.handle_ping(request_id)
                elif command == 'chat':
                    self.process_chat(payload['message'], request_id)
                # ... other command handlers ...

            except Exception as e:
                # Send error with request_id if available
                error_msg = {
                    "error": str(e)
                }
                if 'request_id' in locals():
                    error_msg["requestId"] = request_id
                print(json.dumps(error_msg), flush=True)

if __name__ == "__main__":
    server = PythonServer()
    server.run()