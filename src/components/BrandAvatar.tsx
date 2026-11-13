import { Avatar, type AvatarProps } from '@mui/material';

export const AVATAR_URL = 'https://avatars.githubusercontent.com/u/213731755?v=4';

export function BrandAvatar({ sx, ...rest }: Omit<AvatarProps, 'src' | 'alt'>) {
  return (
    <Avatar
      src={AVATAR_URL}
      alt="abucnasty"
      sx={{
        border: '3px solid',
        borderColor: 'primary.main',
        flexShrink: 0,
        ...sx,
      }}
      {...rest}
    />
  );
}
