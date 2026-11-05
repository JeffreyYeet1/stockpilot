import { Suspense } from "react";
import { Await, useLoaderData, type ActionFunctionArgs } from "react-router";
import { Dashboard, DashboardLoading } from "../components/Dashboard";
import { dashboardAction, loadDashboard } from "../inventory/dashboard.server";
import { DEMO_SHOP, seededGraphql } from "../inventory/demo.server";

const benchmarking = process.env.STOCKPILOT_BENCHMARK === "1";
const graphql = benchmarking ? seededGraphql(1050, 10) : seededGraphql();

function requireDemo(request: Request) {
  const hostname = new URL(request.url).hostname;
  if (!import.meta.env.DEV || process.env.STOCKPILOT_DEMO !== "1" ||
      !["localhost", "127.0.0.1", "[::1]"].includes(hostname)) {
    throw new Response("Not found", { status: 404 });
  }
}

export function loader({ request }: ActionFunctionArgs) {
  requireDemo(request);
  return { dashboard: loadDashboard(DEMO_SHOP, graphql) };
}

export function action({ request }: ActionFunctionArgs) {
  requireDemo(request);
  return dashboardAction(request, DEMO_SHOP, graphql);
}

export default function DemoDashboard() {
  const { dashboard } = useLoaderData<typeof loader>();
  return <Suspense fallback={<DashboardLoading demo />}>
    <Await resolve={dashboard} errorElement={<DashboardLoading demo failed />}>
      {data => <Dashboard data={data} demo />}
    </Await>
  </Suspense>;
}
