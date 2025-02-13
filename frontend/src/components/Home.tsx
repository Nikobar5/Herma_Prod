import React, { useState, useRef, useEffect } from "react";
//import axios from "axios";
const { ipcRenderer } = window.require('electron');
import {marked} from 'marked';

declare global {
  interface Window {
    require: (module: string) => any;
  }
}

interface Message {
  text: string;
  isUser: boolean;
}

const Home: React.FC = () => {
  const [chatMessage, setChatMessage] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasStarted, setHasStarted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<string[]>([]);

  const messageEndRef = useRef<HTMLDivElement | null>(null);

  const scrollToBottom = () => {
    messageEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]); // Auto-scroll whenever messages are updated

  const handleChatInput = (event: React.ChangeEvent<HTMLInputElement>) => {
    setChatMessage(event.target.value);
  };

  // Handle image upload
  const isImage = (filename: string) => {
    return /\.(jpg|jpeg|png|gif)$/i.test(filename);
  };

  useEffect(() => {
  const messageHandler = (_event: any, chunk: string) => {
    setMessages(prevMessages => {
      const lastMessage = prevMessages[prevMessages.length - 1];
      if (lastMessage && !lastMessage.isUser) {
        // Update existing bot message
        const updatedMessage = {
          ...lastMessage,
          text: marked(lastMessage.text + chunk)
        };
        return [...prevMessages.slice(0, -1), updatedMessage];
      } else {
        // Create new bot message
        return [...prevMessages, { text: marked(chunk), isUser: false }];
      }
    });
  };

  ipcRenderer.on('chat-response', messageHandler);

  // Cleanup listener on unmount
  return () => {
    ipcRenderer.removeListener('chat-response', messageHandler);
  };
  }, []);

//   // Update handleFileUpload to automatically select new files
//   const handleFileUpload = async (
//     event: React.ChangeEvent<HTMLInputElement>
//   ) => {
//     const file = event.target.files?.[0];
//     if (!file) return;
//
//     setIsUploading(true);
//     const formData = new FormData();
//     formData.append("file", file);
//
//     try {
//       await axios.post("http://127.0.0.1:5001/upload", formData, {
//         headers: { "Content-Type": "multipart/form-data" },
//       });
//       // Fetch updated file list after successful upload
//       const response = await axios.get("http://127.0.0.1:5001/files");
//       setUploadedFiles(response.data.files);
//
//       // Automatically select the new file for context
//       await axios.post("http://127.0.0.1:5001/select-files", {
//         filenames: response.data.files,
//       });
//     } catch (error) {
//       console.error("Error uploading file:", error);
//     } finally {
//       setIsUploading(false);
//     }
//   };
    const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      setIsUploading(true);
      try {
        const buffer = await file.arrayBuffer();
        await ipcRenderer.invoke('upload-file', {
          filename: file.name,
          data: Buffer.from(buffer)
        });

        // Get updated file list
        const files = await ipcRenderer.invoke('get-files');
        setUploadedFiles(files);
      } catch (error) {
        console.error("Error uploading file:", error);
      } finally {
        setIsUploading(false);
      }
    };

  // File retrieve for sidebar and state
//   const fetchAndSelectFiles = async () => {
//     try {
//       const response = await axios.get("http://127.0.0.1:5001/files");
//       console.log("Fetched files response:", response);
//       setUploadedFiles(response.data.files);
//       // Automatically select all files for context
//       await axios.post("http://127.0.0.1:5001/select-files", {
//         filenames: response.data.files,
//       });
//       console.log("Select files response:", selectResponse);
//     } catch (error) {
//       console.error("Error fetching files:", error);
//     }
//   };
    const fetchAndSelectFiles = async () => {
      try {
        const files = await ipcRenderer.invoke('get-files');
        setUploadedFiles(files);
        await ipcRenderer.invoke('select-files', { filenames: files });
      } catch (error) {
        console.error("Error fetching files:", error);
      }
    };

  // Make files clickable
//   const handleFileClick = (filename: string) => {
//     const fileUrl = `http://127.0.0.1:5001/view/${filename}`;
//     window.open(fileUrl, "_blank");
//   };
    const handleFileClick = async (filename: string) => {
      try {
        await ipcRenderer.invoke('open-file', { filename });
      } catch (error) {
        console.error("Error opening file:", error);
      }
    };

  // Deletes file from the server
//   const handleDeleteFile = async (filename: string, e: React.MouseEvent) => {
//     e.stopPropagation(); // Prevent triggering file click
//
//     if (window.confirm(`Are you sure you want to delete ${filename}?`)) {
//       try {
//         await axios.delete(`http://127.0.0.1:5001/delete/${filename}`);
//         await fetchAndSelectFiles(); // Refresh file list
//       } catch (error) {
//         console.error("Error deleting file:", error);
//       }
//     }
//   };
    const handleDeleteFile = async (filename: string, e: React.MouseEvent) => {
      e.stopPropagation();

      if (window.confirm(`Are you sure you want to delete ${filename}?`)) {
        try {
          await ipcRenderer.invoke('delete-file', { filename });
          await fetchAndSelectFiles();
        } catch (error) {
          console.error("Error deleting file:", error);
        }
      }
    };

  // Fetch uploaded files upon setup (and also select-files for context)
  useEffect(() => {
    fetchAndSelectFiles();
  }, []);

//   const handleSubmit = async (event: React.FormEvent) => {
//     event.preventDefault();
//
//     if (!chatMessage.trim()) return;
//
//     const currentMessage = chatMessage; // Store chatMessage locally
//
//     // Add user message to the message list
//     const userMessage: Message = { text: currentMessage, isUser: true };
//     setMessages((prevMessages) => [...prevMessages, userMessage]);
//     setLoading(true);
//     setChatMessage("");
//
//     const eventSource = new EventSource(`http://127.0.0.1:5001/chat?message=${encodeURIComponent(currentMessage)}`);
//
//     eventSource.onmessage = (event) => {
//         const chunk = event.data;
//         console.log("Received chunk:", chunk);
//         setMessages((prevMessages) => {
//             const lastMessage = prevMessages[prevMessages.length - 1];
//             console.log("Set last message");
//             if (lastMessage && !lastMessage.isUser) {
//                 lastMessage.text += chunk;
//                 console.log("Concatenated " + chunk);
//                 return [...prevMessages.slice(0, -1), lastMessage];
//             } else {
//                 return [...prevMessages, { text: chunk, isUser: false }];
//             }
//         });
//     };
//
//     eventSource.onerror = () => {
//         console.error("EventSource error:", event);
//         console.error("Ready state:", eventSource.readyState);
//         eventSource.close();
//         setLoading(false);
//     };
//   };
//     const handleSubmit = async (event: React.FormEvent) => {
//       event.preventDefault();
//       if (!chatMessage.trim()) return;
//
//       const currentMessage = chatMessage;
//       setMessages(prevMessages => [...prevMessages, { text: currentMessage, isUser: true }]);
//       setLoading(true);
//       setChatMessage("");
//
//       try {
//         await ipcRenderer.invoke('start-chat', { message: currentMessage });
//       } catch (error) {
//         console.error("Error sending message:", error);
//       } finally {
//         setLoading(false);
//       }
//     };
//
//     // Add this useEffect for chat streaming:
//     useEffect(() => {
//       const messageHandler = (_event: any, data: string) => {
//         setMessages(prevMessages => {
//           const lastMessage = prevMessages[prevMessages.length - 1];
//           if (lastMessage && !lastMessage.isUser) {
//             lastMessage.text += data;
//             return [...prevMessages.slice(0, -1), lastMessage];
//           } else {
//             return [...prevMessages, { text: data, isUser: false }];
//           }
//         });
//       };
//
//       ipcRenderer.on('chat-response', messageHandler);
//       return () => {
//         ipcRenderer.removeListener('chat-response', messageHandler);
//       };
//     }, []);
    const handleSubmit = async (event: React.FormEvent) => {
      event.preventDefault();
      if (!chatMessage.trim()) return;

      const currentMessage = chatMessage;
      // Add user message to the list (no need for markdown on user messages)
      const userMessage: Message = { text: currentMessage, isUser: true };
      setMessages(prevMessages => [...prevMessages, userMessage]);
      setLoading(true);
      setChatMessage("");
      setHasStarted(true);

      try {
        console.log("Attempting to send message:", currentMessage);
        await ipcRenderer.invoke('start-chat', { message: currentMessage });
        // Note: We don't need to handle the bot message here anymore because
        // it's handled by the useEffect listener we added, which already
        // applies marked() to the chunks as they come in
      } catch (error) {
        console.error("Error sending message:", error);
        // Optionally add an error message to the chat
        setMessages(prevMessages => [
          ...prevMessages,
          { text: marked("❌ Error: Failed to send message"), isUser: false }
        ]);
      } finally {
        setLoading(false);
      }
    };
  return (
    <div className="container">
      <div className="sidebar">
        <div className="logo-container">
          <img src="logo.png" alt="Logo" className="logo" />
          <h2>Hermetic</h2>
        </div>
        <div className="files-section">
          <h3>Uploaded Files</h3>
          <ul className="files-list">
            {uploadedFiles.map((filename, index) => (
              <li
                key={index}
                className="file-item"
                onClick={() => handleFileClick(filename)}
                style={{ cursor: "pointer" }}
              >
                {isImage(filename) ? (
                  <img
                    src={`file://${filename}`}
                    alt={filename}
                    className="file-thumbnail"
                  />
                ) : (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    width="16"
                    height="16"
                  >
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z" />
                  </svg>
                )}
                {filename}
                <button
                  className="delete-button"
                  onClick={(e) => handleDeleteFile(filename, e)}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    width="16"
                    height="16"
                  >
                    <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
      {hasStarted ? (
        <div className="chat-container">
          <div className="message-display">
            {messages.map((msg, index) => (
              <div
                key={index}
                className={`message ${
                  msg.isUser ? "user-message" : "bot-message"
                }`}
                dangerouslySetInnerHTML={{ __html: msg.text }}
                />
            ))}
            <div ref={messageEndRef} /> {/* Reference for auto-scrolling */}
          </div>
          <form className="chat-form" onSubmit={handleSubmit}>
            <div className="input-container">
              <input
                type="text"
                placeholder="Ask Herma"
                value={chatMessage}
                onChange={handleChatInput}
                className="chat-input"
                disabled={loading || isUploading}
              />
              <div>
                <label className="upload-button">
                  <input
                    type="file"
                    onChange={handleFileUpload}
                    accept=".pdf,.txt,.md,.docx,.pptx,.xlsx,.csv,.json,.png,.jpg,.jpeg,.gif"
                    style={{ display: "none" }}
                  />
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    width="20"
                    height="20"
                  >
                    <path d="M12 2l4 4h-3v9h-2V6H8l4-4zM4 22v-7h2v5h12v-5h2v7H4z" />
                  </svg>
                </label>
                <button
                  type="submit"
                  className="submit-button"
                  disabled={loading || isUploading}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    width="20"
                    height="20"
                  >
                    <path d="M2 21l21-9L2 3v7l15 2-15 2v7z" />
                  </svg>
                </button>
              </div>
            </div>
          </form>
        </div>
      ) : (
        <div className="centered-start">
          <div className="chat-header">Herma</div>
          {loading && <div className="loading">Loading...</div>}
          <form className="chat-form" onSubmit={handleSubmit}>
            <div className="input-container">
              <input
                type="text"
                placeholder="Ask Herma"
                value={chatMessage}
                onChange={handleChatInput}
                className="chat-input"
                disabled={loading || isUploading}
              />
              <label className="upload-button">
                <input
                  type="file"
                  onChange={handleFileUpload}
                  accept=".pdf,.txt,.md,.docx,.pptx,.xlsx,.csv,.json,.png,.jpg,.jpeg,.gif"
                  style={{ display: "none" }}
                />
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  width="20"
                  height="20"
                >
                  <path d="M12 2l4 4h-3v9h-2V6H8l4-4zM4 22v-7h2v5h12v-5h2v7H4z" />
                </svg>
              </label>
              <button
                type="submit"
                className="submit-button"
                disabled={loading || isUploading}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  width="20"
                  height="20"
                >
                  <path d="M2 21l21-9L2 3v7l15 2-15 2v7z" />
                </svg>
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

export default Home;