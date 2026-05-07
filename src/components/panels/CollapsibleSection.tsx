import { useState, type ReactNode } from 'react';

interface Props {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}

export default function CollapsibleSection({ title, defaultOpen = true, children }: Props) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="panel-section">
      <div className="panel-section-header" onClick={() => setOpen(!open)}>
        <span className={`collapse-arrow ${open ? 'open' : ''}`}>▶</span>
        <span className="panel-section-title">{title}</span>
      </div>
      {open && children}
    </div>
  );
}
