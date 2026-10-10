import { Tabs } from './ui';
export default function MarketTabs({ current }: { current: 'snapshot' | 'whitespace' }) {
  return <Tabs current={current} items={[
    { key: 'snapshot', label: 'Snapshot', href: '/market' },
    { key: 'whitespace', label: 'Whitespace', href: '/market/whitespace' },
  ]} />;
}
