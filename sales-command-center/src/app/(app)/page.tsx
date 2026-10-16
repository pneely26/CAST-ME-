import { requireActor } from "@/server/auth";
import { PageHeader } from "@/components/ui";

export default async function Dashboard() {
  const actor = await requireActor();
  return <PageHeader title="Dashboard" subtitle={`Signed in as ${actor.name}`} />;
}
