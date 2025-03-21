// Home.tsx
import React, { useState, useRef, useEffect } from "react";
let ipcRenderer: any = null;
try {
  if (window.require) {
    const electron = window.require('electron');
    ipcRenderer = electron.ipcRenderer;
  }
} catch (error) {
  console.error('Error accessing Electron API:', error);
}
import {marked} from 'marked';

marked.setOptions({
  gfm: true,
  breaks: true,
  pedantic: false
});

declare global {
  interface Window {
    require: (module: string) => any;
  }
}

interface Message {
  text: string;
  htmlContent?: string | Promise<string>;
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
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const[showAlert, setShowAlert] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);

  const [autoScroll, setAutoScroll] = useState(true);
  const messageDisplayRef = useRef<HTMLDivElement | null>(null);
  const messageEndRef = useRef<HTMLDivElement | null>(null);
  const [charCount, setCharCount] = useState(0);
  const MAX_CHARS = 3000;

  const isNearBottom = () => {
    if (messageDisplayRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = messageDisplayRef.current;

      return scrollHeight - scrollTop - clientHeight < 50;
    }
    return true;
  };

  const scrollToBottom = () => {
    if (messageEndRef.current && autoScroll) {
      messageEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  };

    const handleNewChat = async () => {

      if (loading || isStreaming) {
        try {
          await ipcRenderer.invoke('interrupt-chat');
        } catch (error) {
          console.error("Error interrupting chat:", error);
        }
      }

      setChatMessage("");
      setCharCount(0);

      setLoading(false);
      setIsStreaming(false);
      setAutoScroll(true);

      setMessages([]);

      setHasStarted(false);

      setSelectedFiles([]);

      try {

        await ipcRenderer.invoke('new-session');
      } catch (error) {
        console.error("Error creating new session:", error);
      }
    };

    useEffect(() => {
      const messageDisplay = messageDisplayRef.current;
      if (!messageDisplay) return;

      const handleScroll = () => {

        if (isStreaming) {
          const nearBottom = isNearBottom();


          if (!nearBottom) {
            setAutoScroll(false);
          }
        }
      };

      messageDisplay.addEventListener('scroll', handleScroll);
      return () => {
        messageDisplay.removeEventListener('scroll', handleScroll);
      };
    }, [isStreaming]);

    useEffect(() => {

      const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;
      const isNewUserMessage = lastMessage && lastMessage.isUser;
  
      if (isNewUserMessage) {
        setAutoScroll(true);
        scrollToBottom();
      } else if (autoScroll) {

        scrollToBottom();
      }
    }, [messages, autoScroll]);

    useEffect(() => {

      const inputElement = document.querySelector('.chat-input') as HTMLTextAreaElement;
      if (inputElement && !loading && !isStreaming) {
        inputElement.disabled = false;

        if (hasStarted) {
          inputElement.focus();
        }
      }
    }, [selectedFiles, uploadedFiles]);

const handleChatInput = async (event: React.ChangeEvent<HTMLTextAreaElement>) => {
  const textarea = event.target;
  const newText = event.target.value;

  setCharCount(newText.length);

  const isProbablyPaste = chatMessage.length + 10 < newText.length && newText.length > MAX_CHARS;

  if (newText.length <= MAX_CHARS && !isProbablyPaste) {
    setChatMessage(newText);
  } else if (isProbablyPaste) {

    setCharCount(-1);
    setIsUploading(true);

    const pastedContent = newText.substring(chatMessage.length);
    const blob = new Blob([pastedContent], { type: 'text/plain' });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `paste_${timestamp}.txt`;

    try {

      const arrayBuffer = await blob.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      await ipcRenderer.invoke('upload-file', {
        filename,
        data: buffer
      });

      setUploadedFiles(prev => [...prev, filename]);
      setSelectedFiles(prev => [...prev, filename]);

      await ipcRenderer.invoke('select-files', {
        filenames: [...selectedFiles, filename]
      });

      const files = await ipcRenderer.invoke('get-files');
      setUploadedFiles(files);

    } catch (error) {
      console.error("Error handling paste:", error);
    } finally {
      setIsUploading(false);
      setCharCount(chatMessage.length);
    }
  } else {

    setChatMessage(newText.substring(0, MAX_CHARS));
  }

  textarea.style.height = 'auto';

  const newHeight = Math.min(Math.max(textarea.scrollHeight, 24), 208);

  textarea.style.height = `${newHeight}px`;
};

  const handleSidebarToggle = () => {

    setIsSidebarOpen(!isSidebarOpen);

    const sidebarContainer = document.querySelector('.sidebar-container');
    if (sidebarContainer) {
      if (!isSidebarOpen) {

        sidebarContainer.classList.remove('closed');
      } else {

        sidebarContainer.classList.add('closed');
      }
    }
  };

  const isImage = (filename: string) => {
    return /\.(jpg|jpeg|png|gif)$/i.test(filename);
  };

  useEffect(() => {
  const messageHandler = (_event: any, chunk: string) => {
  console.log("Received chunk:", chunk);
  if (chunk === '[DONE]') {
    console.log("Received DONE signal, stopping stream");
    setLoading(false);
    setIsStreaming(false);
    return;
  }

  if (!isStreaming) {
    setIsStreaming(true);
    setAutoScroll(true);
  }

  setMessages(prevMessages => {
    const lastMessage = prevMessages[prevMessages.length - 1];
    if (lastMessage && !lastMessage.isUser) {
      const updatedText = lastMessage.text + chunk;
      return [
        ...prevMessages.slice(0, -1),
        {
          ...lastMessage,
          text: updatedText,
          htmlContent: marked(updatedText)
        }
      ];
    } else {
      return [...prevMessages, {
        text: chunk,
        htmlContent: marked(chunk),
        isUser: false
      }];
    }
  });

  if (autoScroll) {
    scrollToBottom();
  }
};


    ipcRenderer.on('chat-response', messageHandler);
    return () => {
      ipcRenderer.removeListener('chat-response', messageHandler);
    };
  }, [autoScroll, isStreaming]);

const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (loading || isStreaming) {
    return;
  }
  const file = event.target.files?.[0];
  if (!file) return;

  const validTypes = [
    '.pdf', '.txt', '.md', '.docx', '.pptx',
    '.xlsx', '.csv', '.json'
  ];

  const fileExtension = '.' + file.name.split('.').pop()?.toLowerCase();
  if (!validTypes.includes(fileExtension)) {
    setShowAlert(true);
    event.target.value = '';
    return;
  }

  if (uploadedFiles.includes(file.name)) {
    const confirmReplace = window.confirm(
      `File "${file.name}" already exists. Would you like to replace it?`
    );

    if (!confirmReplace) {
      event.target.value = '';
      return;
    }

    try {
      // First delete the existing file
      await ipcRenderer.invoke('delete-file', {
        filename: file.name
      });
    } catch (error) {
      console.error("Error deleting existing file:", error);
      event.target.value = '';
      return;
    }
  }

  setIsUploading(true);
  try {
    const buffer = await file.arrayBuffer();

    setUploadedFiles(prev => [...prev, file.name]);
    setSelectedFiles(prev => [...prev, file.name]);

    await ipcRenderer.invoke('upload-file', {
      filename: file.name,
      data: Buffer.from(buffer)
    });

    const files = await ipcRenderer.invoke('get-files');
    setUploadedFiles(files);

    setSelectedFiles(prev => [...prev, file.name]);
    await ipcRenderer.invoke('select-files', {
      filenames: [...selectedFiles, file.name]
    });
  } catch (error) {
    console.error("Error uploading file:", error);
  } finally {
    setIsUploading(false);
    event.target.value = '';
  }
};

const handleInterrupt = async () => {
  if (loading && !isStreaming) {
    setMessages(prevMessages => [
      ...prevMessages,
      {
        text: "Response cancelled",
        htmlContent: marked("Response cancelled") as string,
        isUser: false
      }
    ]);
  }

  try {
    await ipcRenderer.invoke('interrupt-chat');
  } catch (error) {
    console.error("Error interrupting chat:", error);
  }

  setLoading(false);
  setIsStreaming(false);
};

  const fetchAndSelectFiles = async () => {
    try {
      const files = await ipcRenderer.invoke('get-files');
      setUploadedFiles(files);
    } catch (error) {
      console.error("Error fetching files:", error);
    }
  };

  const handleFileClick = async (filename: string) => {
    const now = Date.now();
    const lastClick = clickTimers[filename] || 0;
    const isDoubleClick = now - lastClick < 300;

    setClickTimers(prev => ({
      ...prev,
      [filename]: now
    }));

    if (isDoubleClick) {
      try {
        await ipcRenderer.invoke('open-file', { filename });
      } catch (error) {
        console.error("Error opening file:", error);
      }
    } else {
      const isSelected = selectedFiles.includes(filename);
      const newSelectedFiles = isSelected
        ? selectedFiles.filter(f => f !== filename)
        : [...selectedFiles, filename];

      setSelectedFiles(newSelectedFiles);
      await ipcRenderer.invoke('select-files', { filenames: newSelectedFiles });
    }
  };

  const handleDeleteFile = async (filename: string, e: React.MouseEvent) => {

    e.preventDefault();
    e.stopPropagation();
    
    if (window.confirm(`Are you sure you want to delete ${filename}?`)) {
      try {

        const newSelectedFiles = selectedFiles.filter(f => f !== filename);
        setSelectedFiles(newSelectedFiles);

        await ipcRenderer.invoke('select-files', { filenames: newSelectedFiles });

        await ipcRenderer.invoke('delete-file', { filename });

        const files = await ipcRenderer.invoke('get-files');
        setUploadedFiles(files);

        setChatMessage(prev => prev + "");

        setTimeout(() => {
          const inputs = document.querySelectorAll('.chat-input') as NodeListOf<HTMLTextAreaElement>;
          inputs.forEach(input => {
            input.disabled = false;
            input.focus();
          });
        }, 200);
        
      } catch (error) {
        console.error("Error deleting file:", error);
      }
    }
    resetInputState();
  };

  useEffect(() => {
    fetchAndSelectFiles();
  }, []);

const handleSubmit = async (event: React.FormEvent) => {
  event.preventDefault();
  if (!chatMessage.trim()) return;

  const currentMessage = chatMessage;
  const userMessage: Message = { text: currentMessage, isUser: true };
  setMessages(prevMessages => [...prevMessages, userMessage]);
  setLoading(true);
  setIsStreaming(false);
  setChatMessage("");
  setHasStarted(true);
  setAutoScroll(true);

  const textarea = document.querySelector('.chat-input') as HTMLTextAreaElement;
  if (textarea) {
    textarea.style.height = 'auto';
  }

  try {
    console.log("Attempting to send message:", currentMessage);

    const encodedMessage = "_BASE64_" + btoa(unescape(encodeURIComponent(currentMessage)));

    console.log("Sending encoded message");
    await ipcRenderer.invoke('start-chat', { message: encodedMessage });
  } catch (error) {
    console.error("Error sending message:", error);
    setMessages(prevMessages => [
      ...prevMessages,
      { text: "❌ Error: Failed to send message", htmlContent: marked("❌ Error: Failed to send message"), isUser: false }
    ]);
  } finally {

  }
};

const handleKeyPress = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
  if (event.key === 'Enter' && !event.shiftKey) {

    if (isUploading) {
      event.preventDefault();
      return;
    }

    event.preventDefault();
    handleSubmit(event);
    setCharCount(0);
  }
};

  const LoadingDots = () => (
    <div className="loading-dots">
      <div className="dot"></div>
      <div className="dot"></div>
      <div className="dot"></div>
    </div>
  );

  const LoadingMessage = () => (
    <div className="bot-message-container">
      <div className="bot-pfp">
        <img src="Herma.jpeg" alt="Bot" className="bot-logo" />
      </div>
      <div className="message bot-message">
        <LoadingDots />
      </div>
    </div>
  );

  const SidebarLoadingDots = () => (
    <div className="sidebar-loading-dots">
      <div className="sidebar-dot"></div>
      <div className="sidebar-dot"></div>
      <div className="sidebar-dot"></div>
    </div>
  );

  interface FileTypeAlertProps {
    isVisible: boolean;
    onClose: () => void;
  }

  const resetInputState = () => {

    setIsUploading(false);

    const inputs = document.querySelectorAll('.chat-input') as NodeListOf<HTMLTextAreaElement>;
    inputs.forEach(input => {
      input.disabled = false;
    });

    setTimeout(() => {
      const input = hasStarted 
        ? document.querySelector('.chat-form .chat-input') 
        : document.querySelector('.chat-form-centered .chat-input');
      
      if (input) {
        (input as HTMLTextAreaElement).focus();
      }
    }, 100);
  };

  const FileTypeAlert: React.FC<FileTypeAlertProps> = ({ isVisible, onClose }) => {
    if (!isVisible) return null;

    return (
      <div className="alert-overlay">
        <div className="alert-container">
          <div className="alert-content">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="alert-icon"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <div className="alert-text">
              <p>Invalid file type. Please upload only supported file types:</p>
              <p>.pdf, .txt, .md, .docx, .pptx, .xlsx, .csv, .json</p>
            </div>
          </div>
          <button onClick={onClose} className="alert-close-btn">
            Close
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="container">
      <div className={`sidebar-container ${!isSidebarOpen ? 'closed' : ''}`}>
        <div className={`sidebar ${isSidebarOpen ? 'sidebar-open' : 'sidebar-closed'}`}>
          <div className="logo-container">
            <h2>HΞRMΛ</h2>
          </div>
          <div className="files-section">
          <div className="files-header">
            <h3>Uploaded Files</h3>
            {isUploading && <SidebarLoadingDots />}
            <label className={`upload-button ${(loading || isStreaming) ? 'disabled' : ''}`}
                   data-tooltip={`${(loading || isStreaming) ? 'Please wait until response completes' : 'Select files to upload'}`}>
              <input
                type="file"
                onChange={handleFileUpload}
                accept=".pdf,.txt,.md,.docx,.pptx,.xlsx,.csv,.json"
                style={{ display: "none" }}
                disabled={loading || isStreaming}
              />
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="currentColor"
                width="20"
                height="20"
                className={loading || isStreaming ? "disabled-svg" : ""}
              >
                <path d="M20 6h-8l-2-2H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm0 12H4V8h16v10zM8 13.01l1.41 1.41L11 12.84V17h2v-4.16l1.59 1.59L16 13.01 12.01 9 8 13.01z"/>
              </svg>
            </label>
          </div>
            <ul className="files-list">
               {[...uploadedFiles].reverse().map((filename, index) => (
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
                    <svg className="file-pfp"
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      width="16"
                      height="16"
                    >
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z" />
                    </svg>
                  )}
                  <span>{filename}</span>
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

        <div className="sidebar-controls">
          <button
            className="sidebar-toggle"
            onClick={handleSidebarToggle}
            data-tooltip={isSidebarOpen ? "Hide sidebar" : "Show sidebar"}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="currentColor"
              width="24"
              height="24"
            >
              <path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z" />
            </svg>
          </button>
            <button
              className="new-chat-button"
              data-tooltip="New chat"
              onClick={handleNewChat}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="currentColor"
                width="24"
                height="24"
              >
                <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
              </svg>
            </button>
        </div>
      </div>
      <div className="center">
        {hasStarted ? (
          <div className="chat-container">
                <div className="message-display" ref={messageDisplayRef}>
                  {messages.map((msg, index) => (
                    msg.isUser ? (
                      <div key={index} className="message user-message">
                        <div className="rich-text">{msg.text}</div>
                      </div>
                    ) : (
                      <div key={index} className="bot-message-container">
                        <div className="bot-pfp">
                          <img src="Herma.jpeg" alt="Bot" className="bot-logo" />
                        </div>
                        <div className="message bot-message">
                          <div className="rich-text" dangerouslySetInnerHTML={{ __html: msg.htmlContent || '' }} />
                        </div>
                      </div>
                    )
                  ))}
                  {loading && !isStreaming && <LoadingMessage />} {/* Only show loading when loading but not streaming */}
                  <div ref={messageEndRef} />
                </div>
 <form className="chat-form" onSubmit={handleSubmit}>
  <div className="input-bar-buttons">
    <div className="input-container">
      <textarea
        placeholder="Ask Herma Anything!"
        value={chatMessage}
        onChange={handleChatInput}
        onKeyPress={handleKeyPress}
        className="chat-input"
        disabled={loading || (isUploading && !selectedFiles)}
        rows={1}
        style={{ height: 'auto' }}
        onFocus={() => {
          const inputs = document.querySelectorAll('.chat-input') as NodeListOf<HTMLTextAreaElement>;
          inputs.forEach(input => {
            input.disabled = false;
          });
        }}
        onClick={() => {
          const inputs = document.querySelectorAll('.chat-input') as NodeListOf<HTMLTextAreaElement>;
          inputs.forEach(input => {
            input.disabled = false; 
          });
        }}
      />
      {charCount > 0 ? (
        <div className={`char-count ${charCount > MAX_CHARS * 0.9 ? 'char-count-warning' : 'char-count-normal'}`}>
          {charCount}/{MAX_CHARS}
        </div>
      ) : charCount === -1 ? (
        <div className="char-count char-count-normal uploading-paste">
          uploading paste...
        </div>
      ) : null}
    </div>
    <div className="chat-buttons-container">
              <label className={`upload-button ${(loading || isStreaming) ? 'disabled' : ''}`}
               data-tooltip={`${(loading || isStreaming) ? 'Please wait until response completes' : 'Select files to upload'}`}>
          <input
            type="file"
            onChange={handleFileUpload}
            accept=".pdf,.txt,.md,.docx,.pptx,.xlsx,.csv,.json"
            style={{ display: "none" }}
            disabled={loading || isStreaming}
          />
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="currentColor"
            width="20"
            height="20"
            className={loading || isStreaming ? "disabled-svg" : ""}
          >
            <path d="M20 6h-8l-2-2H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm0 12H4V8h16v10zM8 13.01l1.41 1.41L11 12.84V17h2v-4.16l1.59 1.59L16 13.01 12.01 9 8 13.01z"/>
          </svg>
        </label>

      {(loading || isStreaming) ? (
        <button
          type="button"
          className="interrupt-button"
          onClick={handleInterrupt}
          data-tooltip="Stop response"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="currentColor"
            width="25"
            height="25"
          >
            <path d="M6 6h12v12H6z" />
          </svg>
        </button>
      ) : (
        <button
          type="submit"
          className="submit-button"
          disabled={loading || isUploading}
          data-tooltip="Ask Herma"
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
      )}
    </div>
  </div>
  <div className="accuracy-disclaimer">
    Herma isn't perfect. Always verify important information.
  </div>
</form>
          </div>
        ) : (
          <div className="centered-start">
            <div className="chat-header">
              <img src="Herma.jpeg" alt="Logo-Center" className="logo-Center" />
              <span className="center-title">HΞRMΛ</span>
            </div>
            {loading && <div className="loading">Loading...</div>}
            <form className="chat-form-centered" onSubmit={handleSubmit}>
              <div className="input-container">
                <textarea
                    placeholder="Ask Herma Anything!"
                    value={chatMessage}
                    onChange={handleChatInput}
                    onKeyPress={handleKeyPress}
                    className="chat-input"
                    disabled={loading || isUploading}
                    rows={1}
                    style={{ height: 'auto' }}
                  />
                  {charCount > 0 ? (
                    <div className={`char-count ${charCount > MAX_CHARS * 0.9 ? 'char-count-warning' : 'char-count-normal'}`}>
                      {charCount}/{MAX_CHARS}
                    </div>
                  ) : charCount === -1 ? (
                    <div className="char-count char-count-normal uploading-paste">
                      uploading paste...
                    </div>
                  ) : null}
              </div>
                    <label className={`upload-button ${(loading || isStreaming) ? 'disabled' : ''}`}
                           data-tooltip={`${(loading || isStreaming) ? 'Please wait until response completes' : 'Select files to upload'}`}>
                      <input
                        type="file"
                        onChange={handleFileUpload}
                        accept=".pdf,.txt,.md,.docx,.pptx,.xlsx,.csv,.json"
                        style={{ display: "none" }}
                        disabled={loading || isStreaming}
                      />
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        width="20"
                        height="20"
                        className={loading || isStreaming ? "disabled-svg" : ""}
                      >
                        <path d="M20 6h-8l-2-2H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm0 12H4V8h16v10zM8 13.01l1.41 1.41L11 12.84V17h2v-4.16l1.59 1.59L16 13.01 12.01 9 8 13.01z"/>
                      </svg>
                    </label>
                  {isStreaming ? (
                      <button
                        type="button"
                        className="interrupt-button"
                        onClick={handleInterrupt}
                        data-tooltip="Stop response"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 24 24"
                          fill="currentColor"
                          width="25"
                          height="25"
                        >
                          <path d="M6 6h12v12H6z" />
                        </svg>
                      </button>
                    ) : (
                      <button
                        type="submit"
                        className="submit-button"
                        disabled={loading || isUploading}
                        data-tooltip="Ask Herma"
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
                    )}
            </form>
          </div>
        )}
      </div>
      <FileTypeAlert
        isVisible={showAlert}
        onClose={() => setShowAlert(false)}
      />
    </div>
  );
};

export default Home;