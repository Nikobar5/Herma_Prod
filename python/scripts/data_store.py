import os
import pickle

class DataStore:
    def __init__(self, filename):
        self.filename = filename
        self.data = self._load()

    def _load(self):
        if os.path.exists(self.filename):
            with open(self.filename, 'rb') as file:
                return pickle.load(file)
        return []

    def save(self):
        with open(self.filename, 'wb') as file:
            pickle.dump(self.data, file)

    def add(self, item):
        self.data.append(item)

    def update(self, index, item):
        self.data[index] = item

    def delete(self, index):
        del self.data[index]

    def get(self, index):
        return self.data[index]
# automatically add chroma db to specific folder for more efficient retrieval and storing
#only have automatic resorting for uploaded data where most recent goes to top since people will more likely reuse it than sessions
#only need add and delete/update when switch at end, need add, get, set, remove for each and then write merge functionality for just uploadd_data