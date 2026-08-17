import { Terminal } from "@/components/Terminal";
import { TerminalProvider } from "@/state/terminal";

export default function Home() {
  return (
    <TerminalProvider>
      <Terminal />
    </TerminalProvider>
  );
}
