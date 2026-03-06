import React, { useEffect, useState, useRef } from 'react';

const SchedulePanel: React.FC<{
  apiBase: string;
  uploadedFiles: Array<{ id: string; name: string }>;
  uploadDocument: (file: File, prompt?: string) => Promise<any>;
  refreshCases: () => Promise<void>;
}> = ({ apiBase, uploadedFiles, uploadDocument, refreshCases }) => {
  const [schedules, setSchedules] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [addCaseMenu, setAddCaseMenu] = useState<string | null>(null);
  const [uploadingFor, setUploadingFor] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const fetchSchedules = async () => {
    setLoading(true);
    try {
      const r = await fetch(`${apiBase}/api/schedules`);
      const j = await r.json();
      if (j.ok && Array.isArray(j.schedules)) setSchedules(j.schedules.map((s: any) => ({ ...s, id: s.id || String(s._id) })));
    } catch (e) {
      console.error('Failed to fetch schedules', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchSchedules(); }, []);

  useEffect(() => {
    if (!addCaseMenu) return;
    const close = () => setAddCaseMenu(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [addCaseMenu]);

  const handleAddWeek = async () => {
    const name = prompt('Week name', 'Week');
    if (!name) return;
    const date = prompt('Date (optional) - e.g. 01/02/2026', '');
    try {
      const r = await fetch(`${apiBase}/api/schedules`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, date }) });
      const j = await r.json();
      if (j.ok) await fetchSchedules();
      else alert('Failed to create week: ' + (j.error || 'unknown'));
    } catch (e) {
      console.error('Add week failed', e);
    }
  };

  const handleRenameWeek = async (s: any) => {
    const name = prompt('Rename week', s.name || '');
    if (name === null || name === '') return;
    const dateInput = prompt('Set date (optional)', s.date || '');
    const date = dateInput !== null ? dateInput : s.date;
    try {
      const r = await fetch(`${apiBase}/api/schedules/${encodeURIComponent(s.id)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, date }) });
      const j = await r.json();
      if (j.ok) await fetchSchedules();
      else alert('Failed: ' + (j.error || 'unknown'));
    } catch (e) { console.error('Rename week failed', e); }
  };

  const handleDeleteWeek = async (s: any) => {
    if (!confirm('Delete this week and its scheduled items?')) return;
    try {
      const r = await fetch(`${apiBase}/api/schedules/${encodeURIComponent(s.id)}`, { method: 'DELETE' });
      const j = await r.json();
      if (j.ok) await fetchSchedules();
      else alert('Failed: ' + (j.error || 'unknown'));
    } catch (e) { console.error('Delete week failed', e); }
  };

  const handleUploadNewCase = (s: any) => {
    setAddCaseMenu(null);
    setUploadingFor(s.id);
    fileInputRef.current?.click();
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !uploadingFor) return;
    const scheduleId = uploadingFor;
    setUploadingFor(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    try {
      const res = await uploadDocument(file, `Schedule upload for ${file.name}`);
      if (res?.id) {
        await fetch(`${apiBase}/api/schedules/${encodeURIComponent(scheduleId)}/cases`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ caseId: res.id, title: file.name }) });
        await refreshCases();
        await fetchSchedules();
      }
    } catch (err) {
      console.error('Upload to schedule failed', err);
      alert('Upload failed: ' + (err instanceof Error ? err.message : 'Unknown error'));
    }
  };

  const handleAddExistingCase = async (s: any, chosen: { id: string; name: string }) => {
    setAddCaseMenu(null);
    try {
      const r = await fetch(`${apiBase}/api/schedules/${encodeURIComponent(s.id)}/cases`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ caseId: chosen.id, title: chosen.name }) });
      const j = await r.json();
      if (j.ok) await fetchSchedules();
      else alert('Failed to add: ' + (j.error || 'unknown'));
    } catch (e) { console.error('Add case to week failed', e); }
  };

  const handleRenameCaseEntry = async (s: any, entry: any) => {
    const title = prompt('Rename case file', entry.title || '');
    if (title === null) return;
    if (!title.trim()) return;
    try {
      const r = await fetch(`${apiBase}/api/schedules/${encodeURIComponent(s.id)}/cases/${encodeURIComponent(entry.id)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: title.trim() }) });
      const j = await r.json();
      if (j.ok) await fetchSchedules();
      else alert('Failed: ' + (j.error || 'unknown'));
    } catch (e) { console.error('Rename case entry failed', e); }
  };

  const handleRemoveCaseEntry = async (s: any, entry: any) => {
    if (!confirm('Remove this case from the week?')) return;
    try {
      const r = await fetch(`${apiBase}/api/schedules/${encodeURIComponent(s.id)}/cases/${encodeURIComponent(entry.id)}`, { method: 'DELETE' });
      const j = await r.json();
      if (j.ok) await fetchSchedules();
      else alert('Failed: ' + (j.error || 'unknown'));
    } catch (e) { console.error('Remove case entry failed', e); }
  };

  return (
    <div className="bg-slate-900/60 backdrop-blur-lg rounded-2xl border border-blue-500/20 p-6 shadow-2xl">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold">Case Schedule</h2>
        <div className="flex items-center space-x-2">
          <button onClick={handleAddWeek} className="bg-amber-500 text-slate-900 px-3 py-1 rounded">+ Add Week</button>
        </div>
      </div>
      {loading ? (
        <div>Loading schedules...</div>
      ) : schedules.length === 0 ? (
        <div className="text-slate-400">No weeks created yet. Click "Add Week" to start scheduling.</div>
      ) : (
        <div className="space-y-4">
          {schedules.map((s: any) => (
            <div key={s.id} className="bg-slate-800/40 rounded-lg p-4 border border-slate-700">
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center space-x-3">
                    <div className="text-lg font-semibold">{s.name}</div>
                    <div className="text-xs text-slate-400">{s.date || ''}</div>
                  </div>
                </div>
                <div className="flex items-center space-x-2 relative">
                  <button onClick={(e) => { e.stopPropagation(); setAddCaseMenu(addCaseMenu === s.id ? null : s.id); }} className="px-2 py-1 bg-blue-600 text-white rounded text-sm">+ Case</button>
                  {addCaseMenu === s.id && (
                    <div className="absolute top-full left-0 mt-1 z-10 bg-slate-800 border border-slate-600 rounded-lg shadow-xl py-2 min-w-[200px]" onClick={(e) => e.stopPropagation()}>
                      <button onClick={() => handleUploadNewCase(s)} className="w-full text-left px-4 py-2 text-sm hover:bg-slate-700">Upload new file</button>
                      {uploadedFiles.length > 0 ? (
                        uploadedFiles.map((f) => (
                          <button key={f.id} onClick={() => handleAddExistingCase(s, f)} className="w-full text-left px-4 py-2 text-sm hover:bg-slate-700 truncate" title={f.name}>{f.name}</button>
                        ))
                      ) : (
                        <div className="px-4 py-2 text-xs text-slate-400">No uploaded cases. Upload from Dashboard first.</div>
                      )}
                    </div>
                  )}
                  <button onClick={() => handleRenameWeek(s)} className="px-2 py-1 bg-slate-700 rounded text-sm">Rename</button>
                  <button onClick={() => handleDeleteWeek(s)} className="px-2 py-1 bg-red-700 rounded text-sm">Delete</button>
                </div>
              </div>

              <div className="mt-3 space-y-2">
                {(s.cases || []).length === 0 ? (
                  <div className="text-slate-400 text-sm">No cases in this week yet</div>
                ) : (
                  (s.cases || []).map((entry: any) => (
                    <div key={entry.id} className="flex items-center justify-between bg-slate-900/30 rounded px-3 py-2">
                      <div>
                        <div className="text-sm font-medium">{entry.title}</div>
                        <div className="text-xs text-slate-500">ID: {entry.caseId || entry.id}</div>
                      </div>
                      <div className="flex items-center space-x-2">
                        <button onClick={() => handleRenameCaseEntry(s, entry)} className="px-2 py-1 bg-slate-700 rounded text-sm">Rename</button>
                        <button onClick={() => handleRemoveCaseEntry(s, entry)} className="px-2 py-1 bg-red-700 rounded text-sm">Remove</button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      <input ref={fileInputRef} type="file" className="hidden" accept=".pdf,.docx,.png,.jpg,.jpeg,.webp" onChange={handleFileSelected} />
    </div>
  );
};

export default SchedulePanel;
