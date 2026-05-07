import type { ElectricalComponent } from '../../types';
import { useComponentStore } from '../../stores/useComponentStore';
import { PIN_TYPE_LABELS } from '../../constants/categories';

interface Props {
  component: ElectricalComponent;
}

export default function PinListPanel({ component }: Props) {
  const { addPin, removePin } = useComponentStore();

  const getNextPinNumber = () => {
    const nums = component.pins
      .map((p) => Number.parseInt(p.label, 10))
      .filter((n) => Number.isFinite(n));
    let next = 1;
    const set = new Set(nums);
    while (set.has(next)) {
      next += 1;
    }
    return next;
  };

  const handleAdd = () => {
    const next = getNextPinNumber();
    addPin(component.id, String(next), 'bidirectional');
  };

  return (
    <>
      <div className="form-row">
        <button className="btn btn-sm btn-primary" onClick={handleAdd} style={{ flex: 'none' }}>
          +1 引脚
        </button>
        <div style={{ color: 'var(--color-text-dim)', fontSize: 12, display: 'flex', alignItems: 'center' }}>
          默认命名为数字，类型固定为“双向”
        </div>
      </div>

      <div style={{ marginTop: 8 }}>
        {component.pins.length === 0 && (
          <div style={{ color: 'var(--color-text-dim)', fontSize: 12, textAlign: 'center', padding: 10 }}>
            暂无引脚，点击“+1 引脚”自动添加
          </div>
        )}
        {component.pins.map((pin) => (
          <div key={pin.id} className="pin-item">
            <span className="pin-label">{pin.label}</span>
            <span className="pin-type">{PIN_TYPE_LABELS[pin.pinType]}</span>
            <span style={{ fontSize: 10, color: 'var(--color-text-dim)' }}>
              ({Math.round(pin.position.x)}, {Math.round(pin.position.y)})
            </span>
            <div className="pin-actions">
              <button className="btn btn-sm btn-danger" onClick={() => removePin(component.id, pin.id)}>
                删除
              </button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
