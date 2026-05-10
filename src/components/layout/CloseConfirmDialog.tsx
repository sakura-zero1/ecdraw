import { useState } from 'react';
import './CloseConfirmDialog.css';

interface CloseConfirmDialogProps {
  onHideToTray: (remember: boolean) => void;
  onExit: (remember: boolean) => void;
  onClose: () => void;
}

export default function CloseConfirmDialog({ onHideToTray, onExit, onClose }: CloseConfirmDialogProps) {
  const [remember, setRemember] = useState(false);

  return (
    <div className="close-dialog-overlay" onClick={onClose}>
      <div className="close-dialog" onClick={(e) => e.stopPropagation()}>
        <h3>关闭窗口</h3>
        <div className="close-dialog-body">
          请选择关闭方式。隐藏到托盘后可通过系统托盘图标恢复窗口。
        </div>
        <div className="close-dialog-actions">
          <button
            className="btn btn-hide"
            onClick={() => onHideToTray(remember)}
          >
            隐藏到托盘
          </button>
          <button
            className="btn btn-exit"
            onClick={() => onExit(remember)}
          >
            关闭程序
          </button>
        </div>
        <label className="close-dialog-remember">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
          />
          记住选择，不再提醒
        </label>
      </div>
    </div>
  );
}
