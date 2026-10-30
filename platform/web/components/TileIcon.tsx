import NavIcon from './NavIcons';

/** The small icon chip at the top of a tile, drawn from the navigation icon set so the vocabulary stays the same. */
export default function TileIcon({ name }: { name: string }) {
  return <span className="tile-ic" aria-hidden="true"><NavIcon name={name} /></span>;
}
