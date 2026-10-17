import { notFound } from "next/navigation";

import { renderAppIcon } from "@/components/brand/app-icon-image";
import { appIcons } from "@/lib/app-icons";

export const dynamicParams = false;

export const generateStaticParams = () =>
  appIcons.map(({ name }) => ({ name }));

export const GET = async (
  _request: Request,
  { params }: { params: Promise<{ name: string }> }
) => {
  const { name } = await params;
  const icon = appIcons.find((candidate) => candidate.name === name);

  if (!icon) {
    notFound();
  }

  return renderAppIcon(icon);
};
