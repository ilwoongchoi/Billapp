import { getServiceSupabaseClient } from "@/lib/supabase";

interface PropertyOwnerRow {
  id: string;
  user_id: string;
}

export async function getPropertyOwner(
  propertyId: string,
): Promise<PropertyOwnerRow | null> {
  const supabase = getServiceSupabaseClient();
  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase
    .from("properties")
    .select("id, user_id")
    .eq("id", propertyId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return data as PropertyOwnerRow;
}

export async function propertyBelongsToUser(
  propertyId: string,
  userId: string,
): Promise<boolean> {
  const property = await getPropertyOwner(propertyId);
  return Boolean(property?.id && property.user_id === userId);
}

