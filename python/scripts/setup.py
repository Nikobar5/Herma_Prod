import subprocess
# Pull models
# subprocess.check_call(['ollama', 'pull', 'nomic-embed-text'])
subprocess.check_call(['ollama', 'pull', 'all-minilm'])
subprocess.check_call(['ollama', 'pull', 'llama3.2:1b'])