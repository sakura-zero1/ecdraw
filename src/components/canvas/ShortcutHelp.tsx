import { useState, useEffect, useRef } from 'react';

const SHORTCUTS = [
  { category: '工具切换', items: [
    { keys: 'Q', desc: '选择工具' },
    { keys: 'W', desc: '连线工具' },
    { keys: 'A', desc: '矩形工具' },
    { keys: 'S', desc: '圆形工具' },
    { keys: 'D', desc: '椭圆工具' },
    { keys: 'F', desc: '线段工具' },
  ]},
  { category: '编辑操作', items: [
    { keys: 'Ctrl+S', desc: '保存元件' },
    { keys: 'Ctrl+Z', desc: '撤销' },
    { keys: 'Ctrl+D', desc: '复制选中图形' },
    { keys: 'Ctrl+C', desc: '复制到剪贴板' },
    { keys: 'Ctrl+V', desc: '从剪贴板粘贴' },
    { keys: 'Ctrl+X', desc: '剪切选中图形' },
    { keys: 'Delete', desc: '删除选中图形' },
  ]},
  { category: '选择与组合', items: [
    { keys: 'Shift+点击', desc: '多选图形/引脚' },
    { keys: 'Ctrl+G', desc: '组合选中图形' },
    { keys: 'Ctrl+Shift+G', desc: '取消组合' },
    { keys: '双击组合', desc: '进入组内编辑' },
    { keys: 'Esc', desc: '退出编辑/取消选择' },
  ]},
  { category: '旋转与翻转（仅组合）', items: [
    { keys: '工具栏 ↺', desc: '逆时针旋转 90°' },
    { keys: '工具栏 ↻', desc: '顺时针旋转 90°' },
    { keys: '工具栏 ⇔', desc: '水平翻转' },
    { keys: '工具栏 ⇕', desc: '垂直翻转' },
  ]},
  { category: '视图操作', items: [
    { keys: '滚轮', desc: '缩放画布' },
    { keys: '右键拖动', desc: '平移画布' },
  ]},
];

export default function ShortcutHelp() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} className="shortcut-help">
      <button
        className="shortcut-help-btn"
        onClick={() => setOpen(!open)}
        title="快捷键说明"
      >
        ?
      </button>
      {open && (
        <div className="shortcut-help-panel">
          <div className="shortcut-help-title">快捷键说明</div>
          {SHORTCUTS.map((group) => (
            <div key={group.category} className="shortcut-group">
              <div className="shortcut-group-title">{group.category}</div>
              {group.items.map((item) => (
                <div key={item.keys} className="shortcut-row">
                  <kbd>{item.keys}</kbd>
                  <span>{item.desc}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
