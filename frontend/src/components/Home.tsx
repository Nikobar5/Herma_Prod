import React, { useState, useRef, useEffect } from "react";
const { ipcRenderer } = window.require('electron');
import {marked} from 'marked';

declare global {
  interface Window {
    require: (module: string) => any;
  }
}

interface Message {
  text: string;
  htmlContent?: string;
  isUser: boolean;
}

interface ClickTimer {
  [key: string]: number;
}

const Home: React.FC = () => {
  const [chatMessage, setChatMessage] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasStarted, setHasStarted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<string[]>([]);
  const [clickTimers, setClickTimers] = useState<ClickTimer>({});
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);

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
        // Update existing bot message by just concatenating the raw text
        // Then apply markdown to the entire message
        const updatedText = lastMessage.text + chunk;
        return [
          ...prevMessages.slice(0, -1),
          {
          ...lastMessage,
            text: updatedText,
            htmlContent: marked(updatedText) // Store the HTML separately
          }
        ];
      } else {
        // Create new bot message
        return [...prevMessages, {
          text: chunk,
          htmlContent: marked(chunk),
          isUser: false
        }];
      }
    });
  };

  ipcRenderer.on('chat-response', messageHandler);

  // Cleanup listener on unmount
  return () => {
    ipcRenderer.removeListener('chat-response', messageHandler);
  };
  }, []);

    // Handle file upload
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

        // Automatically select the new file
        setSelectedFiles(prev => [...prev, file.name]);
        await ipcRenderer.invoke('select-files', {
          filenames: [...selectedFiles, file.name]
        });
      } catch (error) {
        console.error("Error uploading file:", error);
      } finally {
        setIsUploading(false);
      }
    };

    // Fetch files and select them
    const fetchAndSelectFiles = async () => {
      try {
        const files = await ipcRenderer.invoke('get-files');
        setUploadedFiles(files);
      } catch (error) {
        console.error("Error fetching files:", error);
      }
    };

    // Handle file click
    const handleFileClick = async (filename: string) => {
      const now = Date.now();
      const lastClick = clickTimers[filename] || 0;
      const isDoubleClick = now - lastClick < 300;

      setClickTimers(prev => ({
        ...prev,
        [filename]: now
      }));

      if (isDoubleClick) {
        // Open file on double click
        try {
          await ipcRenderer.invoke('open-file', { filename });
        } catch (error) {
          console.error("Error opening file:", error);
        }
      } else {
        // Toggle selection on single click
        const isSelected = selectedFiles.includes(filename);
        const newSelectedFiles = isSelected
          ? selectedFiles.filter(f => f !== filename)
          : [...selectedFiles, filename];

        setSelectedFiles(newSelectedFiles);
        await ipcRenderer.invoke('select-files', { filenames: newSelectedFiles });
      }
    };

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
        <h2>Herma</h2>
          <img src="Herma.jpeg" alt="Logo" className="logo" />
        </div>
        <div className="files-section">
          <h3>Uploaded Files</h3>
          <ul className="files-list">
            {uploadedFiles.map((filename, index) => (
              <li
                key={index}
                className={`file-item ${selectedFiles.includes(filename) ? 'file-selected' : ''}`}
                onClick={() => handleFileClick(filename)}
                style={{
                    cursor: "pointer",
                    userSelect: "none"
                }}
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
      <div className="center">
        {hasStarted ? (
         <div className="chat-container">
          <div className="message-display">
            {messages.map((msg, index) => (
              msg.isUser ? (
                <div key={index} className="message user-message">
                  <div className="rich-text" dangerouslySetInnerHTML={{ __html: msg.text }} />
                </div>
              ) : (
                <div key={index} className="bot-message-container">
                  <div className="bot-pfp">
                    <img src="boots.jpeg" alt="Bot" className="bot-logo" />
                  </div>
                  <div className="message bot-message">
                    <div className="rich-text" dangerouslySetInnerHTML={{ __html: msg.htmlContent || '' }} />
                  </div>
                </div>
              )
            ))}
            <div ref={messageEndRef} />
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
                      width="25"
                      height="25"
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
                      width="25"
                      height="25"
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
            <div className="chat-header">
              <img src="Herma.jpeg" alt="Logo-Center" className="logo-Center" />
              <span className="center-title" contentEditable="true">Herma</span>
            </div>
            {loading && <div className="loading">Loading...</div>}
            <form className="chat-form-centered" onSubmit={handleSubmit}>
              <div className="input-container">
                <input
                  type="text"
                  placeholder="Ask Herma Anything!"
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
    </div>
  );
};

export default Home;