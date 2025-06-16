import { useState, useEffect, useCallback } from 'react';
import './App.css';


const API_URL = import.meta.env.VITE_API_URL;// Adjust this if your API is hosted elsewhere

// Define TypeScript interfaces
interface Email {
  id: number;
  sender: string;
  recipients: string[];
  subject: string;
  body: string;
  sentAt: string;
  status: 'pending' | 'sent' | 'failed';
}

interface FileUploadProgress {
  file: File;
  progress: number;
  status: 'pending' | 'uploading' | 'complete' | 'error';
  error?: string;
  uploadedPath?: string;
}

// Define available sender email addresses
const SENDER_OPTIONS = [
  'renaise@iedcbootcampcec.org',
  'renaise.sponsorship@iedcbootcampcec.org',
  'renaise.support@iedcbootcampcec.org'
];

// Constants for file chunking
const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB chunks
const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB max file size

function App() {
  const [view, setView] = useState<'compose' | 'list'>('compose');
  const [emails, setEmails] = useState<Email[]>([]);
  const [selectedEmail, setSelectedEmail] = useState<Email | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (view === 'list') {
      fetchEmails();
    }
  }, [view]);

  const fetchEmails = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/emails`);
      const data = await response.json();
      setEmails(data);
    } catch (error) {
      console.error('Error fetching emails:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app-container">
      <header>
        <h1>Simple Mail Service</h1>
        <nav>
          <button className={view === 'compose' ? 'active' : ''} onClick={() => setView('compose')}>
            Compose
          </button>
          <button className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}>
            Sent Emails
          </button>
        </nav>
      </header>

      <main>
        {view === 'compose' ? (
          <ComposeForm onEmailSent={() => {
            setView('list');
          }} />
        ) : (
          <>
            {selectedEmail ? (
              <EmailDetail 
                email={selectedEmail}
                onBack={() => setSelectedEmail(null)}
              />
            ) : (
              <EmailList 
                emails={emails} 
                loading={loading}
                onSelectEmail={setSelectedEmail}
                onRefresh={fetchEmails}
              />
            )}
          </>
        )}
      </main>
    </div>
  );
}

// Component for composing emails
function ComposeForm({ onEmailSent }: { onEmailSent: () => void }) {
  const [sender, setSender] = useState(SENDER_OPTIONS[0]);
  const [recipients, setRecipients] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [fileUploadProgress, setFileUploadProgress] = useState<FileUploadProgress[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  
  // Handle file selection
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files;
    if (!selectedFiles) return;
    
    const filesArray: File[] = [];
    const fileProgressArray: FileUploadProgress[] = [];
    
    for (let i = 0; i < selectedFiles.length; i++) {
      const file = selectedFiles[i];
      
      // Check file size
      if (file.size > MAX_FILE_SIZE) {
        setError(`File ${file.name} exceeds the maximum file size limit of 25MB`);
        continue;
      }
      
      filesArray.push(file);
      fileProgressArray.push({
        file,
        progress: 0,
        status: 'pending'
      });
    }
    
    setFiles(filesArray);
    setFileUploadProgress(fileProgressArray);
  };
  
  // Upload a file in chunks
  const uploadFileInChunks = useCallback(async (file: File): Promise<string | null> => {
    try {
      const fileId = `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
      const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
      
      // Update progress state
      setFileUploadProgress(prev => 
        prev.map(item => 
          item.file === file 
            ? { ...item, status: 'uploading', progress: 0 } 
            : item
        )
      );
      
      // Upload each chunk
      for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
        const start = chunkIndex * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, file.size);
        const chunk = file.slice(start, end);
        
        const response = await fetch(`${API_URL}/upload/chunk?fileId=${fileId}&fileName=${encodeURIComponent(file.name)}&chunkIndex=${chunkIndex}&totalChunks=${totalChunks}`, {
          method: 'POST',
          body: chunk,
          headers: {
            'Content-Type': 'application/octet-stream',
          }
        });
        
        if (!response.ok) {
          throw new Error(`Failed to upload chunk ${chunkIndex}`);
        }
        
        // Update progress
        const progress = Math.round(((chunkIndex + 1) / totalChunks) * 100);
        
        setFileUploadProgress(prev => 
          prev.map(item => 
            item.file === file 
              ? { ...item, progress } 
              : item
          )
        );
      }
      
      // Complete the upload
      const completeResponse = await fetch(`${API_URL}/upload/complete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fileId,
          fileName: file.name,
          totalChunks,
          mimeType: file.type
        })
      });
      
      if (!completeResponse.ok) {
        throw new Error('Failed to complete file upload');
      }
      
      const result = await completeResponse.json();
      
      // Update state with completion
      setFileUploadProgress(prev => 
        prev.map(item => 
          item.file === file 
            ? { 
                ...item, 
                status: 'complete', 
                progress: 100,
                uploadedPath: result.filePath 
              } 
            : item
        )
      );
      
      return result.filePath;
    } catch (err: any) {
      console.error('Error uploading file:', err);
      
      setFileUploadProgress(prev => 
        prev.map(item => 
          item.file === file 
            ? { 
                ...item, 
                status: 'error', 
                error: err.message || 'Upload failed'
              } 
            : item
        )
      );
      
      return null;
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSending(true);

    // Validate form
    if (!sender || !recipients || !subject || !body) {
      setError('Please fill out all required fields');
      setSending(false);
      return;
    }

    try {
      // First upload all files
      const uploadedFilePaths: string[] = [];
      
      if (files.length > 0) {
        for (const file of files) {
          const uploadedPath = await uploadFileInChunks(file);
          if (uploadedPath) {
            uploadedFilePaths.push(uploadedPath);
          }
        }
      }
      
      // Create FormData for the request
      const formData = new FormData();
      formData.append('sender', sender);
      
      // Split recipients by comma and trim whitespace
      const recipientList = recipients
        .split(',')
        .map(r => r.trim())
        .filter(r => r.length > 0);
      
      recipientList.forEach(recipient => {
        formData.append('recipients', recipient);
      });
      
      formData.append('subject', subject);
      formData.append('body', body);
      
      // Reference the uploaded files by path in the form
      uploadedFilePaths.forEach(path => {
        formData.append('attachmentPaths', path);
      });

      // Send the request
      const response = await fetch(`${API_URL}/send`, {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to send email');
      }

      // Clear form and show success message
      setSender(SENDER_OPTIONS[0]);
      setRecipients('');
      setSubject('');
      setBody('');
      setFiles([]);
      setFileUploadProgress([]);
      setSuccess('Email sent successfully!');
      
      // Notify parent component
      setTimeout(() => {
        onEmailSent();
      }, 2000);
      
    } catch (err: any) {
      setError(err.message || 'Failed to send email');
    } finally {
      setSending(false);
    }
  };
  
  const removeFile = (index: number) => {
    const newFiles = [...files];
    newFiles.splice(index, 1);
    
    const newProgress = [...fileUploadProgress];
    newProgress.splice(index, 1);
    
    setFiles(newFiles);
    setFileUploadProgress(newProgress);
  };

  return (
    <div className="compose-container">
      <h2>Compose New Email</h2>
      
      {error && <div className="error-message">{error}</div>}
      {success && <div className="success-message">{success}</div>}
      
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="sender">From:</label>
          <select
            id="sender"
            value={sender}
            onChange={(e) => setSender(e.target.value)}
            disabled={sending}
            required
            className="sender-select"
          >
            {SENDER_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label htmlFor="recipients">To:</label>
          <input
            type="text"
            id="recipients"
            value={recipients}
            onChange={(e) => setRecipients(e.target.value)}
            placeholder="recipient@email.com, another@email.com"
            disabled={sending}
            required
          />
        </div>

        <div className="form-group">
          <label htmlFor="subject">Subject:</label>
          <input
            type="text"
            id="subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Email subject"
            disabled={sending}
            required
          />
        </div>

        <div className="form-group">
          <label htmlFor="body">Message:</label>
          <textarea
            id="body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Type your message here..."
            disabled={sending}
            required
            rows={10}
          />
        </div>

        <div className="form-group">
          <label htmlFor="attachments">Attachments (Max 25MB per file):</label>
          <input
            type="file"
            id="attachments"
            multiple
            onChange={handleFileChange}
            disabled={sending}
            accept="*/*"
          />
          
          {files.length > 0 && (
            <div className="file-list">
              {fileUploadProgress.map((item, index) => (
                <div key={index} className="file-item">
                  <div className="file-info">
                    <span className="file-name">{item.file.name}</span>
                    <span className="file-size">({(item.file.size / 1024 / 1024).toFixed(2)} MB)</span>
                  </div>
                  
                  {item.status === 'uploading' && (
                    <div className="progress-container">
                      <div className="progress-bar" style={{ width: `${item.progress}%` }}></div>
                      <span className="progress-text">{item.progress}%</span>
                    </div>
                  )}
                  
                  {item.status === 'error' && (
                    <div className="file-error">{item.error}</div>
                  )}
                  
                  {!sending && (
                    <button 
                      type="button" 
                      className="remove-file-btn"
                      onClick={() => removeFile(index)}
                    >
                      &times;
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <button type="submit" disabled={sending} className="send-button">
          {sending ? 'Sending...' : 'Send Email'}
        </button>
      </form>
    </div>
  );
}

// Component for listing emails
function EmailList({ 
  emails, 
  loading, 
  onSelectEmail,
  onRefresh 
}: { 
  emails: Email[], 
  loading: boolean,
  onSelectEmail: (email: Email) => void,
  onRefresh: () => void
}) {
  return (
    <div className="email-list-container">
      <div className="list-header">
        <h2>Sent Emails</h2>
        <button onClick={onRefresh} className="refresh-button">
          Refresh
        </button>
      </div>
      
      {loading ? (
        <p>Loading emails...</p>
      ) : emails.length === 0 ? (
        <p>No emails found.</p>
      ) : (
        <ul className="email-list">
          {emails.map((email) => (
            <li key={email.id} onClick={() => onSelectEmail(email)} className="email-item">
              <div className="email-summary">
                <div className="email-subject">{email.subject}</div>
                <div className="email-recipients">
                  To: {email.recipients.join(', ')}
                </div>
              </div>
              <div className="email-status">
                <span className={`status-badge status-${email.status}`}>
                  {email.status}
                </span>
                <span className="email-date">
                  {new Date(email.sentAt).toLocaleString()}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Component for displaying email details
function EmailDetail({ email, onBack }: { email: Email, onBack: () => void }) {
  return (
    <div className="email-detail-container">
      <button onClick={onBack} className="back-button">
        &larr; Back to List
      </button>
      
      <div className="email-header">
        <h2>{email.subject}</h2>
        <span className={`status-badge status-${email.status}`}>
          {email.status}
        </span>
      </div>
      
      <div className="email-meta">
        <p><strong>From:</strong> {email.sender}</p>
        <p><strong>To:</strong> {email.recipients.join(', ')}</p>
        <p><strong>Sent:</strong> {new Date(email.sentAt).toLocaleString()}</p>
      </div>
      
      <div className="email-content">
        <h3>Message:</h3>
        <div className="email-body">
          {email.body}
        </div>
      </div>
    </div>
  );
}

export default App;
