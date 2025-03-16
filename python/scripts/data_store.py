import os
import pickle


class DataStore:
    def __init__(self, filename):
        self.filename = filename
        self.data = self._load()

    def _load(self):
        try:
            if not os.path.exists(self.filename):
                return []
            if os.path.getsize(self.filename) == 0:
                return []

            with open(self.filename, 'rb') as file:
                try:
                    return pickle.load(file)
                except (EOFError, pickle.UnpicklingError):
                    return []
        except Exception as e:
            return []

    def save(self):
        try:
            os.makedirs(os.path.dirname(self.filename), exist_ok=True)
            temp_file = f"{self.filename}.tmp"
            with open(temp_file, 'wb') as file:
                pickle.dump(self.data, file)
            os.replace(temp_file, self.filename)
        except Exception as e:
            print(f"Failed to save DataStore: {str(e)}")

    def add(self, item):
        self.data.append(item)

    def update(self, index, item):
        self.data[index] = item

    def delete(self, index):
        del self.data[index]

    def get(self, index):
        return self.data[index]