"use client";

import { CrashScreen } from "@/components/crash-screen";

const ErrorPage = ({ error }: { error: Error & { digest?: string } }) => (
  <CrashScreen error={error} />
);

export default ErrorPage;
