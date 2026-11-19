import { Toaster } from "@/components/ui/sonner";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import ShieldNav from "./components/ShieldNav";
import { AssistantProvider } from "./components/AssistantChat";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import DownloadsGuard from "./pages/DownloadsGuard";
import CallGuard from "./pages/CallGuard";
import SecurityChecks from "./pages/SecurityChecks";
import NotFound from "./pages/NotFound";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/downloads" component={DownloadsGuard} />
      <Route path="/calls" component={CallGuard} />
      <Route path="/checks" component={SecurityChecks} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <Toaster />
        <AssistantProvider>
          <ShieldNav />
          <main className="min-h-[calc(100vh-5rem)] bg-slate-50">
            <Router />
          </main>
        </AssistantProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
