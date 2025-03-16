import subprocess
subprocess.check_call(['ollama', 'pull', 'all-minilm'])
subprocess.check_call(['ollama', 'pull', 'llama3.2:1b'])
