-- Allow sharing the full secret bucket with a trusted friend.
-- Previously friend_visibility was capped at public|private; owners can now
-- opt into max_visibility=secret (read-only) when sharing their brain.

alter type friend_visibility add value if not exists 'secret';
