"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Spinner } from "@/components/ui/misc";

// A stable address for the Team tab (used by the navigation bar, the profile menu and notifications).
export default function TeamRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace("/settings#team"); }, [router]);
  return <Spinner label="Opening Team" />;
}
