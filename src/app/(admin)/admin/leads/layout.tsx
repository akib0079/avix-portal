/**
 * The board plus a slot for the lead popup: opening a lead from the board
 * renders it in `modal` over the board (see @modal/(.)[id]) instead of
 * leaving the page.
 */
export default function LeadsLayout({
  children,
  modal,
}: {
  children: React.ReactNode;
  modal: React.ReactNode;
}) {
  return (
    <>
      {children}
      {modal}
    </>
  );
}
