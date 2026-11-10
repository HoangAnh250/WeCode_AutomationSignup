import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
export function SearchInput({
  value,
  onChange,
  placeholder = 'Search...',
  label = 'Search',
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
}) {
  return (
    <div className="search-input">
      <Search size={16} aria-hidden="true" />
      <Input
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}
