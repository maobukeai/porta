import { useState } from 'react';
import { setCustomApiBase } from '../api/client';

export function SetupWizard({ onClose }: { onClose: () => void }) {
  const [url, setUrl] = useState('');
  const [isDetecting, setIsDetecting] = useState(false);
  const [detectError, setDetectError] = useState('');

  const handleConfirm = () => {
    const trimmed = url.trim();
    if (!trimmed) return;
    // Auto-add http:// if user forgot
    const normalized = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
    setCustomApiBase(normalized);
    onClose();
  };

  const handleAutoDetect = async () => {
    setIsDetecting(true);
    setDetectError('');

    const subnets = ['192.168.1', '192.168.0', '192.168.31', '10.0.0', '172.16.0'];
    const PORT = 3170;

    // Limit concurrency to 20 at a time to avoid Android WebView crash (765 concurrent = crash)
    const scan = async (ip: string): Promise<string | null> => {
      const target = `http://${ip}:${PORT}`;
      try {
        const res = await fetch(`${target}/api/health`, {
          signal: AbortSignal.timeout(600),
        });
        if (res.ok) return target;
      } catch {
        // unreachable host
      }
      return null;
    };

    // Build full IP list
    const targets: string[] = [];
    for (const subnet of subnets) {
      for (let i = 1; i <= 254; i++) {
        targets.push(`${subnet}.${i}`);
      }
    }

    // Process in batches of 20
    const BATCH = 20;
    let found: string | null = null;
    for (let i = 0; i < targets.length && !found; i += BATCH) {
      const batch = targets.slice(i, i + BATCH);
      const results = await Promise.all(batch.map(scan));
      found = results.find((r) => r !== null) ?? null;
    }

    setIsDetecting(false);
    if (found) {
      setUrl(found);
    } else {
      setDetectError('未找到可用的服务，请手动输入 IP 地址');
    }
  };

  const cardStyle: React.CSSProperties = {
    backgroundColor: 'var(--bg-surface, #1e1e1e)',
    padding: '32px 24px',
    borderRadius: '20px',
    width: '100%',
    maxWidth: '380px',
    boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  };

  const inputStyle: React.CSSProperties = {
    padding: '13px 16px',
    borderRadius: '10px',
    border: '1.5px solid var(--border-default, #333)',
    backgroundColor: 'var(--bg-tertiary, #161616)',
    color: 'var(--text-primary, #fff)',
    fontSize: '15px',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box',
  };

  const btnBase: React.CSSProperties = {
    flex: 1,
    padding: '13px',
    borderRadius: '10px',
    fontSize: '15px',
    fontWeight: 600,
    cursor: 'pointer',
    border: 'none',
    transition: 'opacity 0.15s',
  };

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 9999,
      backgroundColor: 'rgba(0,0,0,0.85)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px',
      color: 'var(--text-primary, #fff)',
    }}>
      <div style={cardStyle}>
        {/* Header */}
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '40px', marginBottom: '8px' }}>📡</div>
          <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700 }}>配置服务器连接</h2>
          <p style={{ margin: '8px 0 0', color: 'var(--text-secondary, #888)', fontSize: '13px', lineHeight: 1.5 }}>
            请输入电脑端 Porta 代理服务的 IP 地址<br />
            手机和电脑需连接同一 WiFi
          </p>
        </div>

        {/* IP Input */}
        <input
          type="url"
          inputMode="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="如：http://192.168.1.100:3170"
          style={inputStyle}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
        />

        {/* Error message */}
        {detectError && (
          <p style={{ margin: 0, color: '#f87171', fontSize: '13px', textAlign: 'center' }}>
            {detectError}
          </p>
        )}

        {/* Buttons */}
        <div style={{ display: 'flex', gap: '10px' }}>
          <button
            onClick={handleAutoDetect}
            disabled={isDetecting}
            style={{
              ...btnBase,
              backgroundColor: 'var(--bg-hover, #2a2a2a)',
              color: 'var(--text-primary, #fff)',
              border: '1.5px solid var(--border-default, #333)',
              opacity: isDetecting ? 0.6 : 1,
            }}
          >
            {isDetecting ? '检测中…' : '🔍 自动检测'}
          </button>
          <button
            onClick={handleConfirm}
            disabled={!url.trim()}
            style={{
              ...btnBase,
              backgroundColor: url.trim() ? 'var(--accent, #6366f1)' : 'var(--bg-hover, #2a2a2a)',
              color: '#fff',
              opacity: url.trim() ? 1 : 0.4,
            }}
          >
            确认连接
          </button>
        </div>

        {/* Skip option */}
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--text-muted, #555)',
            fontSize: '13px',
            cursor: 'pointer',
            textAlign: 'center',
            padding: '4px',
            textDecoration: 'underline',
          }}
        >
          暂时跳过（已有配置或稍后设置）
        </button>
      </div>
    </div>
  );
}
