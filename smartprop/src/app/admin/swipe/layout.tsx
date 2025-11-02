// Custom layout for swipe page - fullscreen mobile experience
export default function SwipeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-[100dvh] w-full overflow-hidden">
      {children}
    </div>
  );
}

