import { Gauge } from 'lucide-react';
import { Slider } from '@/components/ui/primitives';

export default function SpeedControl({ rate, onRateChange }) {
  return (
    <label className="flex items-center gap-2.5" title="Reading speed">
      <Gauge className="h-4 w-4 shrink-0 text-muted-foreground" />
      <Slider
        value={rate}
        onChange={onRateChange}
        min={0.5}
        max={2.5}
        step={0.1}
        aria-label="Reading speed"
        className="w-24 md:w-32"
      />
      <span className="w-10 font-mono text-sm tabular-nums text-muted-foreground">
        {rate.toFixed(1)}×
      </span>
    </label>
  );
}
