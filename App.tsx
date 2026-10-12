import { useEffect, useState } from "react";
import { Button, StyleSheet, Text, TextInput, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { CampusOpsClient } from "./src/api/campusOpsClient";
import { SessionManager, type SessionState, } from "./src/auth/sessionManager";
import { getBackendHealth } from "./src/api/courseBackend";

const sessionManager = new SessionManager();
const campusOpsClient = new CampusOpsClient({
  sessionProvider: sessionManager,
});

export default function App() {
  const [sessionState, setSessionState] = useState<SessionState>(
    sessionManager.state,
  );
  const [actorId, setActorId] = useState("reporter-1");
  const [backendStatus, setBackendStatus] = useState<
    "checking" | "available" | "offline"
  >("checking");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const unsubscribe = sessionManager.subscribe(setSessionState);
    let active = true;
    void sessionManager.restore().catch(() => {
      if (active) setMessage("No se pudo recuperar la sesión guardada.");
    });
    getBackendHealth()
      .then(() => active && setBackendStatus("available"))
      .catch(() => active && setBackendStatus("offline"));
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (sessionState.status !== "authenticated") return;
    const delay = Math.max(0, sessionState.session.expiresAt - Date.now());
    const timeout = setTimeout(() => {
      void sessionManager.getValidSession().catch(() => {
        setMessage("No se pudo renovar la sesión.");
      });
    }, delay);
    return () => clearTimeout(timeout);
  }, [sessionState]);

  async function signIn() {
    setBusy(true);
    setMessage("");
    try {
      await sessionManager.login(actorId.trim());
      setMessage("Sesión iniciada.");
      try {
        await campusOpsClient.findAll();
        setMessage("Sesión iniciada y petición autenticada validada.");
      } catch {
        setMessage("Sesión iniciada; no se pudo validar la petición al backend.");
      }
    } catch {
      setMessage("No se pudo iniciar sesión. Verifica el actor de prueba y el backend.");
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    setBusy(true);
    setMessage("");
    try {
      await sessionManager.logout();
    } catch {
      setMessage("No se pudo borrar la sesión guardada. Intenta cerrar sesión nuevamente.");
    } finally {
      setBusy(false);
    }
  }

  const authenticated =
    sessionState.status === "authenticated" ? sessionState.session : null;

  return (
    <View style={styles.screen}>
      <View accessibilityRole="summary" style={styles.card}>
        <Text style={styles.title}>CampusOps</Text>
        <Text>Incidencias del campus · entorno académico ficticio</Text>
        <Text testID="backend-status">Backend: {backendStatus}</Text>
        <Text testID="session-status">Sesión: {sessionState.status}</Text>

        {authenticated ? (
          <>
            <Text>Actor: {authenticated.actorId}</Text>
            <Text>Perfil: {authenticated.role}</Text>
            <Button
              title="Cerrar sesión"
              onPress={() => void signOut()}
              disabled={busy}
            />
          </>
        ) : (
          <>
            <TextInput
              accessibilityLabel="Actor de prueba"
              autoCapitalize="none"
              onChangeText={setActorId}
              placeholder="reporter-1"
              value={actorId}
            />
            <Button
              title={busy ? "Procesando..." : "Iniciar sesión"}
              onPress={() => void signIn()}
              disabled={busy || sessionState.status === "refreshing"}
            />
          </>
        )}
        {message ? <Text accessibilityRole="alert">{message}</Text> : null}
      </View>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: "center", padding: 24 },
  card: { gap: 12, padding: 20 },
  title: { fontSize: 24, fontWeight: "700" },
});
