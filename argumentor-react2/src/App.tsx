import React, { useState, useRef, useEffect, useCallback } from 'react';
import { io } from 'socket.io-client';
import { Scale, Upload, FileText, TrendingUp, Target, Database, ChevronDown, User, Settings, LogOut, RefreshCw, Copy, CheckCircle, AlertCircle, Clock, BarChart3, Sparkles, MessageSquare, Send, Bot, UserCircle, Paperclip, Mic, Trash2 } from 'lucide-react';
import OutcomeWidget from './OutcomeWidget';
import SchedulePanel from './SchedulePanel';

const App: React.FC = () => {
  const API_BASE = window.location.origin;
  const [activeTab, setActiveTab] = useState<'dashboard' | 'analysis' | 'chat' | 'counterarguments' | 'outcome' | 'memory' | 'schedule'>('dashboard');
  const [processing, setProcessing] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<Array<{ id: string; name: string; date: string; size?: string }>>([]);
  const [loadingCases, setLoadingCases] = useState(true);
  const [activeResultTab, setActiveResultTab] = useState<'summary' | 'entities' | 'evidence'>('summary');
  const [chatMessages, setChatMessages] = useState<Array<{ id: number; sender: 'bot' | 'user'; text: string; timestamp: string }>>([
    {
      id: 1,
      sender: 'bot',
      text: 'Hello! I am ArguMentor AI, your virtual legal assistant. How can I help you with your case today?',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }
  ]);
  const [chatInput, setChatInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const chatContainerRef = useRef<HTMLDivElement | null>(null);
  const [socketId, setSocketId] = useState<string | undefined>('');
  const socketRef = useRef<ReturnType<typeof io> | null>(null);
  const dashboardFileInputRef = useRef<HTMLInputElement | null>(null);
  const chatAttachmentInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadingCase, setUploadingCase] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);
  const [chatUploading, setChatUploading] = useState(false);
  const [chatAttachmentStatus, setChatAttachmentStatus] = useState<{ message: string; tone: 'info' | 'success' | 'error' } | null>(null);
  const [memoTemplateFile, setMemoTemplateFile] = useState<File | null>(null);
  const [memoStatus, setMemoStatus] = useState<{ message: string; tone: 'info' | 'success' | 'error' } | null>(null);

  // Analysis tab state
  const [caseId, setCaseId] = useState<string>('');
  const [customQuery, setCustomQuery] = useState<string>('Summarize and extract entities and arguments.');
  const [analysisResult, setAnalysisResult] = useState<{ summary?: string; reasoning?: string; structured?: any } | null>(null);

  const tabs = [
    { id: 'dashboard', label: 'Dashboard', icon: BarChart3 },
    { id: 'analysis', label: 'Case Analysis', icon: FileText },
    { id: 'chat', label: 'AI Assistant', icon: MessageSquare },
    { id: 'counterarguments', label: 'Counterarguments', icon: Target },
    { id: 'outcome', label: 'Outcome Predictor', icon: TrendingUp },
    { id: 'memory', label: 'Case Memory', icon: Database },
    { id: 'schedule', label: 'Case Schedule', icon: Clock }
  ] as const;

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [chatMessages, isTyping]);

  // Connect Socket.IO for live chat streaming
  useEffect(() => {
    const s = io(API_BASE);
    socketRef.current = s;
    s.on('connect', () => setSocketId(s.id));
    s.on('chat:delta', (data: { text: string }) => {
      setIsTyping(true);
      setChatMessages(prev => {
        const out = [...prev];
        const last = out[out.length - 1];
        if (!last || last.sender !== 'bot') {
          out.push({ id: out.length + 1, sender: 'bot', text: data.text, timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) });
        } else {
          last.text += data.text;
        }
        return out;
      });
    });
    s.on('chat:end', () => setIsTyping(false));
    s.on('chat:error', () => setIsTyping(false));
    return () => { try { s.disconnect(); } catch {} };
  }, []);

  const fetchCases = useCallback(async (preferredId?: string) => {
    try {
      setLoadingCases(true);
      const resp = await fetch(`${API_BASE}/api/cases`);
      const data = await resp.json();
      if (data.ok && Array.isArray(data.cases)) {
        const formattedCases = data.cases.map((c: any) => ({
          id: c.id,
          name: c.filename,
          date: c.uploadedAt ? new Date(c.uploadedAt).toLocaleDateString() : 'Unknown',
        }));
        setUploadedFiles(formattedCases);
        if (preferredId) {
          setCaseId(preferredId);
        } else {
          setCaseId(prev => prev || (formattedCases[0]?.id ?? ''));
        }
      }
    } catch (e) {
      console.error('Failed to fetch cases:', e);
    } finally {
      setLoadingCases(false);
    }
  }, []);

  useEffect(() => {
    fetchCases();
  }, [fetchCases]);

  const uploadDocument = useCallback(async (file: File, prompt?: string) => {
    const formData = new FormData();
    formData.append('file', file);
    if (prompt) {
      formData.append('prompt', prompt);
    }
    let resp;
    try {
      resp = await fetch(`${API_BASE}/api/upload`, {
        method: 'POST',
        body: formData
      });
    } catch (err) {
      // Network/fetch error
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Network error during upload: ${msg}`);
    }

    let data;
    try {
      data = await resp.json();
    } catch (parseErr) {
      const text = await resp.text().catch(() => '');
      throw new Error(`Upload failed: ${resp.status} ${resp.statusText} - ${text || 'No details'}`);
    }

    if (!resp.ok || !data?.ok) {
      const errMsg = data?.error || `Upload failed: ${resp.status} ${resp.statusText}`;
      throw new Error(errMsg);
    }

    return data;
  }, []);

  const sendChatMessage = useCallback(async (text: string, options?: { preserveInput?: boolean }) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    const newMessage = {
      id: chatMessages.length + 1,
      sender: 'user' as const,
      text: trimmed,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    const updatedHistory = [...chatMessages, newMessage];
    setChatMessages(updatedHistory);
    if (!options?.preserveInput) {
      setChatInput('');
    }

    const clientIdentifier = socketId || socketRef.current?.id;
    if (!clientIdentifier) {
      console.warn('Socket not connected; cannot send chat message');
      return;
    }

    setIsTyping(true);
    try {
      await fetch(`${API_BASE}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: clientIdentifier,
          history: updatedHistory.map(m => ({ role: m.sender, content: m.text })),
          message: trimmed
        })
      });
    } catch (err) {
      console.error('Chat request failed:', err);
      setIsTyping(false);
    }
  }, [chatMessages, socketId]);

  const handleSendMessage = async () => {
    await sendChatMessage(chatInput);
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleAnalysis = async () => {
    if (!caseId.trim() || !customQuery.trim()) return;
    setProcessing(true);
    setAnalysisResult(null);
    setUploadError(null);
    try {
      console.log(`[Analysis] Requesting analysis for case: ${caseId}`);
      const resp = await fetch(`${API_BASE}/api/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caseId, query: customQuery })
      });
      
      let data;
      try {
        data = await resp.json();
      } catch (parseError) {
        const text = await resp.text();
        console.error('[Analysis] Response not JSON:', text);
        throw new Error(`Server error: ${resp.status} ${resp.statusText}`);
      }
      
      console.log(`[Analysis] Response:`, data);
      
      if (!resp.ok) {
        const errorMsg = data?.error || 'Analysis failed';
        // Remove any Groq references from error messages
        const cleanError = errorMsg.replace(/groq|Groq|GROQ/gi, 'Mistral 7B');
        throw new Error(cleanError);
      }
      
      if (!data.ok) {
        throw new Error(data.error || 'Analysis returned failure status');
      }
      
      setAnalysisResult({
        summary: data.summary || data.reasoning?.slice(0, 1000) || 'Analysis completed',
        reasoning: data.reasoning || '',
        structured: data.structured || {}
      });
      setActiveResultTab('summary');
    } catch (e: any) {
      console.error('[Analysis] Error:', e);
      const errorMsg = e.message || 'Analysis failed';
      // Ensure no Groq references
      const cleanError = errorMsg.replace(/groq|Groq|GROQ/gi, 'Mistral 7B');
      setAnalysisResult({ summary: `Error: ${cleanError}` });
      setUploadError(cleanError);
      setTimeout(() => setUploadError(null), 5000);
    } finally {
      setProcessing(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingCase(true);
    setUploadError(null);
    setUploadSuccess(null);
    try {
      const data = await uploadDocument(file, `Initial ingestion for ${file.name}`);
      await fetchCases(data.id);
      setCaseId(prev => prev || data.id);
      setUploadSuccess(`Uploaded ${file.name}`);
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[App] Upload failed:', msg);
      setUploadError(msg);
    } finally {
      setUploadingCase(false);
      if (dashboardFileInputRef.current) dashboardFileInputRef.current.value = '';
    }
  };

  const handleChatAttachment = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setChatAttachmentStatus({ message: `Uploading "${file.name}"...`, tone: 'info' });
    setChatUploading(true);
    try {
      const data = await uploadDocument(file, `Analyze the attachment "${file.name}" and incorporate it into the active conversation context.`);
      await fetchCases(data.id);
      setCaseId(prev => prev || data.id);
      await sendChatMessage(`Attachment uploaded: ${file.name}. Reference Case ID ${data.id} for analysis.`, { preserveInput: true });
      setChatAttachmentStatus({ message: `Attachment uploaded: ${file.name}`, tone: 'success' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Attachment upload failed';
      setChatAttachmentStatus({ message, tone: 'error' });
    } finally {
      setChatUploading(false);
      setTimeout(() => setChatAttachmentStatus(null), 5000);
      if (chatAttachmentInputRef.current) {
        chatAttachmentInputRef.current.value = '';
      }
    }
  };

  const handleMemoTemplateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    setMemoTemplateFile(file);
    setMemoStatus(null);
  };

  const handleGenerateMemo = async () => {
    try {
      if (!memoTemplateFile) {
        setMemoStatus({ message: 'Please upload a memo template file first.', tone: 'error' });
        return;
      }
      if (!caseId.trim()) {
        setMemoStatus({ message: 'Please select or upload a case before generating a memo.', tone: 'error' });
        return;
      }

      setMemoStatus({ message: 'Generating memo with AI...', tone: 'info' });

      const formData = new FormData();
      formData.append('template', memoTemplateFile);
      formData.append('caseId', caseId);

      const resp = await fetch(`${API_BASE}/api/memo/generate`, {
        method: 'POST',
        body: formData
      });

      const contentType = resp.headers.get('Content-Type') || '';
      if (!resp.ok) {
        let errorMessage = `Memo generation failed (${resp.status})`;
        if (contentType.includes('application/json')) {
          const data = await resp.json().catch(() => null);
          if (data?.error) {
            errorMessage = data.error;
          }
        } else {
          const text = await resp.text().catch(() => '');
          if (text) {
            errorMessage = text.slice(0, 300);
          }
        }
        setMemoStatus({ message: errorMessage, tone: 'error' });
        return;
      }

      const blob = await resp.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');

      const disposition = resp.headers.get('Content-Disposition') || '';
      let filename = 'legal-memo.txt';
      const match = /filename="([^"]+)"/i.exec(disposition);
      if (match && match[1]) {
        filename = match[1];
      }

      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      setMemoStatus({ message: `Memo downloaded as ${filename}`, tone: 'success' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Memo generation failed';
      setMemoStatus({ message, tone: 'error' });
    }
  };

  const handleDeleteCase = async (caseIdToDelete: string, e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation(); // Prevent case selection when clicking delete
    }
    
    if (!confirm(`Are you sure you want to delete this case "${caseIdToDelete}"? This action cannot be undone.`)) {
      return;
    }

    try {
      console.log(`[Delete] Attempting to delete case: ${caseIdToDelete}`);
      const resp = await fetch(`${API_BASE}/api/cases/${encodeURIComponent(caseIdToDelete)}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      // Read response as text first, then parse as JSON
      const responseText = await resp.text();
      let data;
      
      try {
        data = JSON.parse(responseText);
      } catch (parseError) {
        console.error('[Delete] Response not JSON:', responseText);
        throw new Error(`Server error: ${resp.status} ${resp.statusText} - ${responseText.slice(0, 100)}`);
      }
      
      console.log(`[Delete] Response:`, data);
      
      if (resp.ok && data.ok) {
        // Remove from local state
        setUploadedFiles(prev => prev.filter(f => f.id !== caseIdToDelete));
        // Clear selected case if it was deleted
        if (caseId === caseIdToDelete) {
          setCaseId('');
        }
        setUploadSuccess(`Case deleted successfully`);
        setTimeout(() => setUploadSuccess(null), 3000);
        // Refresh cases list
        await fetchCases();
      } else {
        throw new Error(data.error || `Delete failed: ${resp.status}`);
      }
    } catch (error) {
      console.error('[Delete] Error:', error);
      const message = error instanceof Error ? error.message : 'Delete failed';
      setUploadError(`Delete failed: ${message}`);
      setTimeout(() => setUploadError(null), 5000);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-blue-950 to-slate-900 text-white">
      <nav className="bg-slate-900/80 backdrop-blur-xl border-b border-blue-500/20 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-8">
              <div className="flex items-center space-x-3">
                <Scale className="w-8 h-8 text-amber-400" />
                <span className="text-2xl font-bold bg-gradient-to-r from-amber-400 to-amber-200 bg-clip-text text-transparent">ArguMentor</span>
              </div>
              <div className="hidden lg:flex items-center space-x-1">
                {tabs.map((tab) => {
                  const Icon = tab.icon;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id as typeof activeTab)}
                      className={`flex items-center space-x-2 px-4 py-2 rounded-lg transition-all duration-300 ${
                        activeTab === (tab.id as typeof activeTab)
                          ? 'bg-blue-600/30 text-amber-400 border border-blue-500/30'
                          : 'text-slate-300 hover:bg-slate-800/50'
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                      <span className="text-sm font-medium">{tab.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="relative">
              <button
                onClick={() => setShowProfile(!showProfile)}
                className="flex items-center space-x-2 px-4 py-2 bg-slate-800/50 rounded-lg hover:bg-slate-700/50 transition-all"
              >
                <User className="w-5 h-5" />
                <ChevronDown className="w-4 h-4" />
              </button>
              {showProfile && (
                <div className="absolute right-0 mt-2 w-48 bg-slate-800 rounded-lg border border-blue-500/20 shadow-xl animate-in fade-in slide-in-from-top-2 duration-200">
                  <button className="flex items-center space-x-2 px-4 py-3 w-full hover:bg-slate-700 transition-colors">
                    <Settings className="w-4 h-4" />
                    <span>Settings</span>
                  </button>
                  <button className="flex items-center space-x-2 px-4 py-3 w-full hover:bg-slate-700 transition-colors rounded-b-lg">
                    <LogOut className="w-4 h-4" />
                    <span>Logout</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-6 py-8">
        {activeTab === 'dashboard' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-in fade-in duration-500">
            <div className="lg:col-span-1">
              <div className="bg-slate-900/60 backdrop-blur-lg rounded-2xl border border-blue-500/20 p-6 shadow-2xl transform transition-all duration-300 hover:scale-[1.02]">
                <h2 className="text-xl font-bold mb-4 flex items-center space-x-2">
                  <Upload className="w-5 h-5 text-amber-400" />
                  <span>Upload Case Files</span>
                </h2>
                <label className={`block cursor-pointer ${uploadingCase ? 'opacity-70 pointer-events-none' : ''}`}>
                  <input
                    ref={dashboardFileInputRef}
                    type="file"
                    onChange={handleFileUpload}
                    className="hidden"
                    accept=".pdf,.docx,.png,.jpg,.jpeg,.webp"
                    disabled={uploadingCase}
                  />
                  <div className="bg-gradient-to-br from-blue-600/20 to-purple-600/20 border-2 border-dashed border-blue-500/40 rounded-xl p-8 text-center hover:border-amber-400/60 transition-all duration-300 hover:scale-105">
                    <Upload className="w-12 h-12 mx-auto mb-3 text-blue-400 animate-bounce" />
                    <p className="text-sm text-slate-300">Click to upload</p>
                    <p className="text-xs text-slate-500 mt-1">PDF, DOCX, PNG, JPG, WEBP</p>
                  </div>
                </label>
                {uploadingCase && <p className="text-xs text-blue-400 mt-3">Uploading...</p>}
                {uploadError && <p className="text-xs text-red-400 mt-2">{uploadError}</p>}
                {!uploadError && uploadSuccess && <p className="text-xs text-green-400 mt-2">{uploadSuccess}</p>}
                <div className="mt-6 space-y-3">
                  <h3 className="text-sm font-semibold text-slate-400">Recent Uploads</h3>
                  {loadingCases ? (
                    <div className="text-sm text-slate-400 py-4">Loading cases...</div>
                  ) : uploadedFiles.length === 0 ? (
                    <div className="text-sm text-slate-400 py-4">No cases uploaded yet</div>
                  ) : (
                    uploadedFiles.map((file, idx) => (
                      <div key={idx} className={`bg-slate-800/50 rounded-lg p-3 border transition-all duration-200 hover:bg-slate-800 hover:scale-[1.02] cursor-pointer ${caseId === file.id ? 'border-blue-500 bg-blue-900/20' : 'border-slate-700/50'}`} onClick={() => setCaseId(file.id)}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-2 flex-1">
                            <FileText className="w-4 h-4 text-blue-400" />
                            <div className="flex-1">
                              <p className="text-sm font-medium">{file.name}</p>
                              <p className="text-xs text-slate-500">{file.date}</p>
                              <p className="text-xs text-blue-400 font-mono mt-1 truncate">ID: {file.id}</p>
                            </div>
                          </div>
                          <button
                            onClick={(e) => handleDeleteCase(file.id, e)}
                            className="p-2 hover:bg-red-900/30 rounded-lg transition-all hover:scale-110 text-red-400 hover:text-red-300"
                            title="Delete case"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            <div className="lg:col-span-1">
              <div className="grid grid-cols-1 gap-6">
                {[
                  { title: 'Total Cases Analyzed', value: '127', color: 'blue', icon: BarChart3 },
                  { title: 'Avg Processing Time', value: '4.2s', color: 'purple', icon: Clock },
                  { title: 'Insights Generated', value: '1,543', color: 'amber', icon: Sparkles }
                ].map((stat, idx) => (
                  <div
                    key={idx}
                    className={`bg-gradient-to-br from-${stat.color}-600/20 to-${stat.color}-800/20 backdrop-blur-lg rounded-2xl border border-${stat.color}-500/30 p-6 shadow-2xl transform transition-all duration-300 hover:scale-[1.05] animate-in slide-in-from-bottom-4`}
                    style={{ animationDelay: `${idx * 100}ms` }}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-slate-400 text-sm">{stat.title}</p>
                        <p className="text-4xl font-bold text-amber-400 mt-2">{stat.value}</p>
                      </div>
                      <stat.icon className={`w-12 h-12 text-${stat.color}-400 opacity-50`} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="lg:col-span-1">
              <div className="space-y-4">
                {[
                  { title: 'Start New Analysis', desc: 'Upload and analyze a case', icon: Sparkles, gradient: true },
                  { title: 'View Saved Cases', desc: 'Access previous analyses', icon: Database, gradient: false },
                  { title: 'AI Chat Assistant', desc: 'Ask legal questions', icon: MessageSquare, gradient: false }
                ].map((action, idx) => (
                  <button
                    key={idx}
                    onClick={() => idx === 2 && setActiveTab('chat')}
                    className={`w-full ${
                      action.gradient
                        ? 'bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600'
                        : 'bg-slate-800/60 hover:bg-slate-700/60 border border-slate-700'
                    } rounded-xl p-6 shadow-xl transition-all duration-300 transform hover:scale-105 animate-in slide-in-from-right-4`}
                    style={{ animationDelay: `${idx * 100}ms` }}
                  >
                    <action.icon className={`w-8 h-8 mx-auto mb-2 ${action.gradient ? 'text-amber-400' : 'text-purple-400'}`} />
                    <p className="font-bold text-lg">{action.title}</p>
                    <p className="text-xs text-slate-400 mt-1">{action.desc}</p>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'chat' && (
          <div className="animate-in fade-in duration-500">
            <h1 className="text-3xl font-bold mb-6 flex items-center space-x-3">
              <MessageSquare className="w-8 h-8 text-amber-400" />
              <span>AI Legal Assistant</span>
              <span className="text-sm font-normal text-slate-400 ml-auto flex items-center space-x-2">
                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                <span>Online</span>
              </span>
            </h1>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2">
                <div className="bg-slate-900/60 backdrop-blur-lg rounded-2xl border border-blue-500/20 shadow-2xl flex flex-col h-[600px]">
                  <div className="p-4 border-b border-slate-700/50 flex items-center space-x-3">
                    <div className="w-10 h-10 bg-gradient-to-br from-blue-600 to-purple-600 rounded-full flex items-center justify-center">
                      <Bot className="w-6 h-6 text-white" />
                    </div>
                    <div>
                      <h3 className="font-semibold">ArguMentor AI</h3>
                      <p className="text-xs text-green-400">Active now</p>
                    </div>
                  </div>
                  <div ref={chatContainerRef} className="flex-1 overflow-y-auto p-6 space-y-4 scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent">
                    {chatMessages.map((message, idx) => (
                      <div
                        key={message.id}
                        className={`flex ${message.sender === 'user' ? 'justify-end' : 'justify-start'} animate-in slide-in-from-bottom-2 fade-in duration-300`}
                        style={{ animationDelay: `${idx * 50}ms` }}
                      >
                        <div className={`flex items-start space-x-2 max-w-[80%] ${message.sender === 'user' ? 'flex-row-reverse space-x-reverse' : ''}`}>
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                            message.sender === 'user' ? 'bg-gradient-to-br from-amber-600 to-amber-500' : 'bg-gradient-to-br from-blue-600 to-purple-600'
                          }`}>
                            {message.sender === 'user' ? (
                              <UserCircle className="w-5 h-5 text-white" />
                            ) : (
                              <Bot className="w-5 h-5 text-white" />
                            )}
                          </div>
                          <div>
                            <div className={`rounded-2xl p-4 ${
                              message.sender === 'user'
                                ? 'bg-gradient-to-br from-amber-600/20 to-amber-700/20 border border-amber-500/30'
                                : 'bg-slate-800/80 border border-blue-500/20'
                            }`}>
                              <p className="text-sm leading-relaxed whitespace-pre-wrap">{message.text}</p>
                            </div>
                            <p className={`text-xs text-slate-500 mt-1 ${message.sender === 'user' ? 'text-right' : 'text-left'}`}>{message.timestamp}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                    {isTyping && (
                      <div className="flex justify-start animate-in slide-in-from-bottom-2 fade-in">
                        <div className="flex items-start space-x-2">
                          <div className="w-8 h-8 bg-gradient-to-br from-blue-600 to-purple-600 rounded-full flex items-center justify-center">
                            <Bot className="w-5 h-5 text-white" />
                          </div>
                          <div className="bg-slate-800/80 border border-blue-500/20 rounded-2xl p-4">
                            <div className="flex space-x-2">
                              <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                              <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                              <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                    <div ref={messagesEndRef} />
                  </div>
                  <div className="p-4 border-t border-slate-700/50">
                    <div className="flex items-center space-x-2">
                      <button
                        type="button"
                        onClick={() => chatAttachmentInputRef.current?.click()}
                        disabled={chatUploading}
                        className="p-2 hover:bg-slate-800 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        title="Attach a case file"
                      >
                        <Paperclip className="w-5 h-5 text-slate-400" />
                      </button>
                      <input
                        ref={chatAttachmentInputRef}
                        type="file"
                        className="hidden"
                        onChange={handleChatAttachment}
                        accept=".pdf,.docx,.png,.jpg,.jpeg,.webp"
                        disabled={chatUploading}
                      />
                      <input
                        type="text"
                        value={chatInput}
                        onChange={(e) => setChatInput(e.target.value)}
                        onKeyPress={handleKeyPress}
                        placeholder="Ask about your case, legal precedents, or strategies..."
                        className="flex-1 bg-slate-800/50 border border-slate-700 rounded-lg px-4 py-3 focus:border-blue-500 focus:outline-none transition-colors"
                      />
                      <button className="p-2 hover:bg-slate-800 rounded-lg transition-colors">
                        <Mic className="w-5 h-5 text-slate-400" />
                      </button>
                      <button
                        onClick={handleSendMessage}
                        disabled={!chatInput.trim()}
                        className="bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 disabled:opacity-50 disabled:cursor-not-allowed p-3 rounded-lg transition-all transform hover:scale-105 active:scale-95"
                      >
                        <Send className="w-5 h-5" />
                      </button>
                    </div>
                    {chatAttachmentStatus && (
                      <p
                        className={`text-xs mt-2 ${
                          chatAttachmentStatus.tone === 'error'
                            ? 'text-red-400'
                            : chatAttachmentStatus.tone === 'success'
                              ? 'text-green-400'
                              : 'text-slate-400'
                        }`}
                      >
                        {chatAttachmentStatus.message}
                      </p>
                    )}
                  </div>
                </div>
              </div>
              <div className="space-y-4">
                <div className="bg-slate-900/60 backdrop-blur-lg rounded-2xl border border-blue-500/20 p-6 shadow-2xl">
                  <h3 className="font-semibold text-amber-400 mb-4 flex items-center space-x-2">
                    <Sparkles className="w-4 h-4" />
                    <span>Quick Actions</span>
                  </h3>
                  <div className="space-y-2">
                    {[
                      'Analyze uploaded documents',
                      'Generate counterarguments',
                      'Find similar precedents',
                      'Predict case outcome',
                      'Draft legal memo'
                    ].map((action, idx) => (
                      <button
                        key={idx}
                        onClick={() => setChatInput(action)}
                        className="w-full text-left px-4 py-3 bg-slate-800/50 hover:bg-slate-700/50 rounded-lg text-sm transition-all duration-200 hover:scale-[1.02] border border-slate-700/50 hover:border-blue-500/30"
                      >
                        {action}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="bg-slate-900/60 backdrop-blur-lg rounded-2xl border border-blue-500/20 p-6 shadow-2xl">
                  <h3 className="font-semibold text-amber-400 mb-4 flex items-center space-x-2">
                    <FileText className="w-4 h-4" />
                    <span>Legal Memo Generator</span>
                  </h3>
                  <p className="text-xs text-slate-400 mb-3">
                    Upload a memo template (DOCX, TXT, or Markdown) and generate a filled legal memorandum
                    for the currently selected case.
                  </p>
                  <div className="space-y-3">
                    <div>
                      <label className="text-xs text-slate-400 block mb-1">Selected Case ID</label>
                      <p className="text-xs text-blue-300 font-mono break-all min-h-[1.25rem]">
                        {caseId || 'No case selected'}
                      </p>
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs text-slate-400 block">Memo Template</label>
                      <input
                        type="file"
                        accept=".docx,.txt,.md,.markdown"
                        onChange={handleMemoTemplateChange}
                        className="block w-full text-xs text-slate-300 file:mr-2 file:px-2 file:py-1 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-blue-700 file:text-white hover:file:bg-blue-600 cursor-pointer"
                      />
                      {memoTemplateFile && (
                        <p className="text-xs text-slate-400 truncate">
                          Selected: <span className="text-slate-200">{memoTemplateFile.name}</span>
                        </p>
                      )}
                    </div>
                    <button
                      onClick={handleGenerateMemo}
                      className="w-full bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 rounded-lg py-2 text-sm font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                      disabled={!caseId.trim() || !memoTemplateFile}
                    >
                      Generate & Download Memo
                    </button>
                    {memoStatus && (
                      <p
                        className={`text-xs mt-1 ${
                          memoStatus.tone === 'error'
                            ? 'text-red-400'
                            : memoStatus.tone === 'success'
                            ? 'text-green-400'
                            : 'text-slate-400'
                        }`}
                      >
                        {memoStatus.message}
                      </p>
                    )}
                  </div>
                </div>
                <div className="bg-slate-900/60 backdrop-blur-lg rounded-2xl border border-blue-500/20 p-6 shadow-2xl">
                  <h3 className="font-semibold text-amber-400 mb-4">Chat Statistics</h3>
                  <div className="space-y-3">
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-400">Messages</span>
                      <span className="text-white font-semibold">{chatMessages.length}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-400">Response Time</span>
                      <span className="text-green-400 font-semibold">~2s</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-400">Accuracy</span>
                      <span className="text-blue-400 font-semibold">96%</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'schedule' && (
          <div className="animate-in fade-in duration-500">
            <h1 className="text-3xl font-bold mb-6 flex items-center space-x-3">
              <Clock className="w-8 h-8 text-amber-400" />
              <span>Case Schedule</span>
            </h1>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2">
                <SchedulePanel apiBase={window.location.origin} uploadedFiles={uploadedFiles} uploadDocument={uploadDocument} refreshCases={fetchCases} />
              </div>
              <div className="lg:col-span-1">
                <div className="bg-slate-900/60 rounded-2xl border border-blue-500/20 p-6 shadow-2xl">
                  <div className="text-sm font-semibold text-slate-400">Schedule Help</div>
                  <p className="text-xs text-slate-400 mt-3">Create a week, add existing cases or upload new ones into a week. Rename weeks and cases, or remove case entries when done.</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'analysis' && (
          <div className="animate-in fade-in duration-500">
            <h1 className="text-3xl font-bold mb-6 flex items-center space-x-3">
              <FileText className="w-8 h-8 text-amber-400" />
              <span>Case Intelligence Workspace</span>
            </h1>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-slate-900/60 backdrop-blur-lg rounded-2xl border border-blue-500/20 p-6 shadow-2xl">
                <h2 className="text-lg font-bold mb-4 text-amber-400">Analysis Controls</h2>
                <div className="space-y-4">
                  <div>
                    <label className="text-sm text-slate-400 mb-2 block">Select Case</label>
                    <select
                      value={caseId}
                      onChange={(e) => setCaseId(e.target.value)}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-white focus:border-blue-500 focus:outline-none transition-colors"
                    >
                      <option value="">Choose a case...</option>
                      {uploadedFiles.map((file) => (
                        <option key={file.id} value={file.id}>
                          {file.name} ({file.date})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-sm text-slate-400 mb-2 block">Or Enter Case ID</label>
                    <input
                      value={caseId}
                      onChange={(e) => setCaseId(e.target.value)}
                      placeholder="Paste MongoDB ObjectId here"
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-white focus:border-blue-500 focus:outline-none transition-colors"
                    />
                  </div>
                  <div>
                    <label className="text-sm text-slate-400 mb-2 block">Custom Query</label>
                    <textarea
                      value={customQuery}
                      onChange={(e) => setCustomQuery(e.target.value)}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 h-24 resize-none text-white focus:border-blue-500 focus:outline-none transition-colors"
                      placeholder="Enter legal questions..."
                    />
                  </div>
                  <button
                    onClick={handleAnalysis}
                    disabled={processing}
                    className="w-full bg-gradient-to-r from-amber-600 to-amber-500 rounded-lg py-3 font-bold transition-all disabled:opacity-50 flex items-center justify-center space-x-2 hover:scale-[1.02] active:scale-95"
                  >
                    {processing ? (
                      <>
                        <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        <span>Processing...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-5 h-5" />
                        <span>Run Analysis</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
              <div className="bg-slate-900/60 backdrop-blur-lg rounded-2xl border border-blue-500/20 p-6 shadow-2xl">
                <h2 className="text-lg font-bold mb-4 text-amber-400">Analysis Results</h2>
                <div className="flex space-x-2 mb-4">
                  {['summary', 'entities', 'evidence'].map((tab) => (
                    <button
                      key={tab}
                      onClick={() => setActiveResultTab(tab as typeof activeResultTab)}
                      className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeResultTab === (tab as typeof activeResultTab) ? 'bg-blue-600 scale-105' : 'bg-slate-800 hover:bg-slate-700'}`}
                    >
                      {tab.charAt(0).toUpperCase() + tab.slice(1)}
                    </button>
                  ))}
                </div>
                <div className="bg-slate-800/50 rounded-lg p-4 min-h-[300px]">
                  {activeResultTab === 'summary' && (
                    <div className="space-y-3 text-sm text-slate-300 animate-in fade-in duration-300">
                      {analysisResult ? (
                        <>
                          <p className="whitespace-pre-wrap">{analysisResult.summary || 'No summary available.'}</p>
                          {analysisResult.reasoning && (
                            <div className="mt-4">
                              <p className="text-amber-400 font-semibold mb-1">Reasoning</p>
                              <p className="whitespace-pre-wrap text-slate-300">{analysisResult.reasoning}</p>
                            </div>
                          )}
                        </>
                      ) : (
                        <>
                          <p><span className="text-amber-400 font-semibold">Case Type:</span> Contract Dispute</p>
                          <p><span className="text-amber-400 font-semibold">Parties:</span> Smith vs Jones</p>
                          <p className="mt-4">The analysis reveals three primary arguments from the plaintiff centered on explicit contractual obligations.</p>
                        </>
                      )}
                    </div>
                  )}
                  {activeResultTab === 'entities' && (
                    <div className="space-y-2 text-sm text-slate-300 animate-in fade-in duration-300">
                      {analysisResult?.structured?.entities?.length ? (
                        analysisResult.structured.entities.map((e: any, idx: number) => (
                          <div key={idx} className="bg-slate-900/60 border border-slate-700 rounded-lg p-3">{typeof e === 'string' ? e : JSON.stringify(e)}</div>
                        ))
                      ) : (
                        <p className="text-slate-500">No entities available.</p>
                      )}
                    </div>
                  )}
                  {activeResultTab === 'evidence' && (
                    <div className="space-y-2 text-sm text-slate-300 animate-in fade-in duration-300">
                      {analysisResult?.structured ? (
                        <pre className="whitespace-pre-wrap text-xs">{JSON.stringify(analysisResult.structured, null, 2)}</pre>
                      ) : (
                        <p className="text-slate-500">Run analysis to view structured data.</p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'outcome' && (
          <div className="animate-in fade-in duration-500">
            <h1 className="text-3xl font-bold mb-6 flex items-center space-x-3">
              <TrendingUp className="w-8 h-8 text-amber-400" />
              <span>Outcome Predictor</span>
            </h1>
            <OutcomeWidget caseId={caseId} />
          </div>
        )}

        {activeTab === 'memory' && (
          <div className="animate-in fade-in duration-500">
            <h1 className="text-3xl font-bold mb-6 flex items-center space-x-3">
              <Database className="w-8 h-8 text-amber-400" />
              <span>Case Memory</span>
            </h1>
            <div className="bg-slate-900/60 backdrop-blur-lg rounded-2xl border border-blue-500/20 p-6 shadow-2xl">
              <div className="space-y-3">
                {loadingCases ? (
                  <div className="text-slate-400 py-4">Loading cases...</div>
                ) : uploadedFiles.length === 0 ? (
                  <div className="text-slate-400 py-4">No cases in memory. Upload a case to get started.</div>
                ) : (
                  uploadedFiles.map((caseItem, idx) => (
                    <div
                      key={idx}
                      className={`bg-slate-800/50 rounded-lg p-4 flex items-center justify-between transform transition-all duration-200 hover:bg-slate-800 hover:scale-[1.02] animate-in slide-in-from-left-4 ${caseId === caseItem.id ? 'border border-blue-500' : ''}`}
                      style={{ animationDelay: `${idx * 100}ms` }}
                    >
                      <div className="flex-1">
                        <h3 className="font-semibold">{caseItem.name}</h3>
                        <p className="text-xs text-slate-400">Uploaded: {caseItem.date}</p>
                        <p className="text-xs text-blue-400 font-mono mt-1">ID: {caseItem.id}</p>
                      </div>
                      <div className="flex space-x-2">
                        <button 
                          onClick={() => setCaseId(caseItem.id)}
                          className="p-2 bg-blue-700 hover:bg-blue-600 rounded-lg transition-all hover:scale-110"
                          title="Select case"
                        >
                          <FileText className="w-4 h-4" />
                        </button>
                        <button 
                          onClick={(e) => handleDeleteCase(caseItem.id, e)}
                          className="p-2 bg-red-900/30 hover:bg-red-900/50 text-red-400 hover:text-red-300 rounded-lg transition-all hover:scale-110"
                          title="Delete case"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'counterarguments' && (
          <div className="animate-in fade-in duration-500">
            <h1 className="text-3xl font-bold mb-6 flex items-center space-x-3">
              <Target className="w-8 h-8 text-amber-400" />
              <span>Counterargument Generator</span>
            </h1>
            <div className="mb-6 bg-slate-900/60 backdrop-blur-lg rounded-2xl border border-blue-500/20 p-6 shadow-2xl">
              <label className="text-sm text-slate-400 mb-2 block">Select Case</label>
              <select
                value={caseId}
                onChange={(e) => setCaseId(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-white focus:border-blue-500 focus:outline-none transition-colors"
              >
                <option value="">Choose a case...</option>
                {uploadedFiles.map((file) => (
                  <option key={file.id} value={file.id}>
                    {file.name} ({file.date})
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-slate-900/60 backdrop-blur-lg rounded-2xl border border-blue-500/20 p-6 shadow-2xl">
                <h2 className="text-lg font-bold mb-4 text-amber-400">Extracted Arguments</h2>
                <div className="space-y-4">
                  <div className="bg-blue-900/20 border border-blue-500/30 rounded-lg p-4 transform transition-all duration-300 hover:scale-[1.02] animate-in slide-in-from-left-4">
                    <p className="text-xs text-blue-400 font-semibold mb-2">PETITIONER</p>
                    <p className="text-sm text-slate-300">The defendant violated the non-compete clause by engaging with a direct competitor within the restricted period.</p>
                    <div className="mt-2 flex items-center space-x-2">
                      <div className="h-1.5 bg-slate-700 rounded-full flex-1 overflow-hidden">
                        <div className="h-full bg-blue-500 rounded-full animate-in slide-in-from-left duration-1000" style={{ width: '85%' }} />
                      </div>
                      <span className="text-xs text-slate-400">85%</span>
                    </div>
                  </div>
                  <div className="bg-red-900/20 border border-red-500/30 rounded-lg p-4 transform transition-all duration-300 hover:scale-[1.02] animate-in slide-in-from-left-4" style={{ animationDelay: '100ms' }}>
                    <p className="text-xs text-red-400 font-semibold mb-2">RESPONDENT</p>
                    <p className="text-sm text-slate-300">The non-compete clause is overly broad and unenforceable under state law, limiting legitimate career opportunities.</p>
                    <div className="mt-2 flex items-center space-x-2">
                      <div className="h-1.5 bg-slate-700 rounded-full flex-1 overflow-hidden">
                        <div className="h-full bg-red-500 rounded-full animate-in slide-in-from-left duration-1000" style={{ width: '72%', animationDelay: '100ms' }} />
                      </div>
                      <span className="text-xs text-slate-400">72%</span>
                    </div>
                  </div>
                </div>
              </div>
              <div className="bg-slate-900/60 backdrop-blur-lg rounded-2xl border border-blue-500/20 p-6 shadow-2xl">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-bold text-amber-400">AI-Generated Counterarguments</h2>
                  <div className="flex space-x-2">
                    <button className="p-2 bg-slate-800 hover:bg-slate-700 rounded-lg transition-all hover:scale-110">
                      <RefreshCw className="w-4 h-4" />
                    </button>
                    <button className="p-2 bg-slate-800 hover:bg-slate-700 rounded-lg transition-all hover:scale-110">
                      <Copy className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <div className="space-y-4">
                  {[
                    { title: 'COUNTER TO PETITIONER', confidence: 'High', icon: CheckCircle, color: 'green', text: 'Challenge the reasonableness of geographic and temporal restrictions. Cite precedents where courts found similar clauses overly restrictive.' },
                    { title: 'COUNTER TO RESPONDENT', confidence: 'Medium', icon: AlertCircle, color: 'amber', text: 'Demonstrate legitimate business interests requiring protection. Present evidence of proprietary information access and competitive harm.' }
                  ].map((counter, idx) => (
                    <div key={idx} className="bg-purple-900/20 border border-purple-500/30 rounded-lg p-4 transform transition-all duration-300 hover:scale-[1.02] animate-in slide-in-from-right-4" style={{ animationDelay: `${idx * 100}ms` }}>
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-xs text-purple-400 font-semibold">{counter.title}</p>
                        <div className="flex items-center space-x-1">
                          <counter.icon className={`w-3 h-3 text-${counter.color}-400`} />
                          <span className="text-xs text-slate-400">{counter.confidence} Confidence</span>
                        </div>
                      </div>
                      <p className="text-sm text-slate-300">{counter.text}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <footer className="bg-slate-900/80 backdrop-blur-xl border-t border-blue-500/20 mt-12">
        <div className="max-w-7xl mx-auto px-6 py-6">
          <div className="flex items-center justify-between text-sm text-slate-400">
            <div className="flex items-center space-x-2">
              <Scale className="w-4 h-4 text-amber-400" />
              <span>© 2025 ArguMentor – Virtual Courtroom Intelligence System</span>
              <span className="text-slate-600">|</span>
              <span className="text-slate-500">Empowering Legal Preparedness</span>
            </div>
            <div className="flex items-center space-x-2">
              <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
              <span>
                AI Engine: <span className="text-green-400 font-semibold">Online</span>
              </span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default App;


