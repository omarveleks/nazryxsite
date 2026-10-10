import { toggleFollow } from '@/app/actions/app';
export default function FollowButton({ id, following, back }: { id: number; following: boolean; back: string }) {
  return (
    <form action={toggleFollow}>
      <input type="hidden" name="company_id" value={id} /><input type="hidden" name="return" value={back} />
      <button className={`btn btn-sm ${following ? 'btn-ghost' : 'btn-ghost'}`} type="submit">{following ? 'Following ✓' : 'Follow'}</button>
    </form>
  );
}
