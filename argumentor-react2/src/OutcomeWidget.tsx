import React, { useEffect, useState } from 'react';
import { AlertCircle, Loader } from 'lucide-react';

type Props = { caseId: string };

const OutcomeWidget: React.FC<Props> = ({ caseId }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reasoning, setReasoning] = useState<string>('');
  const [plaintiff, setPlaintiff] = useState<number | null>(null);
  const [defendant, setDefendant] = useState<number | null>(null);
  const canRun = Boolean(caseId);

  const run = async () => {
    if (!canRun) return;
    setLoading(true);
    setError(null);
    console.log('[OutcomeWidget] Calling /api/predict-outcome with caseId:', caseId);
    
    try {
      const resp = await fetch(`${window.location.origin}/api/predict-outcome`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caseId })
      });

      console.log('[OutcomeWidget] Response status:', resp.status);

      if (!resp.ok) {
        const errorData = await resp.json();
        console.error('[OutcomeWidget] Error response:', errorData);
        throw new Error(errorData?.error || `HTTP ${resp.status}: Prediction failed`);
      }

      const data = await resp.json();
      console.log('[OutcomeWidget] Success response:', data);

      if (!data.ok) {
        throw new Error(data?.error || 'Prediction returned failure status');
      }

      setPlaintiff(data?.probabilities?.plaintiff ?? null);
      setDefendant(data?.probabilities?.defendant ?? null);
      setReasoning(data?.reasoning || '');
      console.log('[OutcomeWidget] Probabilities set - Plaintiff:', data?.probabilities?.plaintiff, 'Defendant:', data?.probabilities?.defendant);
    } catch (e: any) {
      console.error('[OutcomeWidget] Error:', e);
      setError(e.message || 'Unknown error occurred');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setPlaintiff(null);
    setDefendant(null);
    setError(null);
    setReasoning('');
  }, [caseId]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm text-slate-400">Case ID</div>
          <div className="text-lg font-semibold text-blue-400">{caseId || 'No case selected'}</div>
        </div>
        <button
          onClick={run}
          disabled={!canRun || loading}
          className="px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-700 disabled:opacity-50 rounded-lg font-semibold transition-all flex items-center space-x-2"
        >
          {loading ? (
            <>
              <Loader className="w-4 h-4 animate-spin" />
              <span>Predicting…</span>
            </>
          ) : (
            <span>Predict Outcome</span>
          )}
        </button>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-500/50 rounded-lg p-4 flex items-start space-x-3">
          <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-red-400">Prediction Failed</p>
            <p className="text-red-300 text-sm">{error}</p>
            <p className="text-red-300 text-xs mt-2 opacity-75">Ensure a case is uploaded and Backend is running</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-6">
        {[
          { label: 'Plaintiff Victory', value: plaintiff, color: '#22c55e', bgColor: 'from-green-600/20 to-green-800/20', borderColor: 'border-green-500/30' },
          { label: 'Defendant Victory', value: defendant, color: '#ef4444', bgColor: 'from-red-600/20 to-red-800/20', borderColor: 'border-red-500/30' }
        ].map((outcome, idx) => (
          <div
            key={idx}
            className={`bg-gradient-to-br ${outcome.bgColor} rounded-xl p-8 border ${outcome.borderColor} transform transition-all duration-300 hover:scale-105`}
          >
            <p className="text-sm text-slate-400 mb-2">{outcome.label}</p>
            <p className="text-6xl font-bold" style={{ color: outcome.color }}>
              {outcome.value != null ? `${outcome.value}%` : '—'}
            </p>
          </div>
        ))}
      </div>

      {reasoning && (
        <div className="bg-slate-800/50 rounded-lg p-4 border border-blue-500/20">
          <p className="text-sm font-semibold text-amber-400 mb-2">AI Reasoning</p>
          <p className="text-sm text-slate-300 whitespace-pre-wrap">{reasoning}</p>
        </div>
      )}
    </div>
  );
};

export default OutcomeWidget;


