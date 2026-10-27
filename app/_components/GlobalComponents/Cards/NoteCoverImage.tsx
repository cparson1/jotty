"use client";

import { ReactNode, useEffect, useState } from "react";

interface NoteCoverImageProps {
  src?: string;
  className?: string;
  fallback?: ReactNode;
}

export const NoteCoverImage = ({
  src,
  className,
  fallback = null,
}: NoteCoverImageProps) => {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (!src || failed) return <>{fallback}</>;

  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={className}
    />
  );
};
