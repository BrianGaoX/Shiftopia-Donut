import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
dotenv.config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY
);

async function run() {
  const { data: shift, error: shiftError } = await supabase
    .from("shifts")
    .select("id")
    .limit(1)
    .single();

  if (shiftError || !shift) {
    console.error("No shift found", shiftError);
    return;
  }

  const { data, error } = await supabase.rpc("check_in_shift", {
    p_shift_id: shift.id,
    p_lat: -33.921136,
    p_lon: 151.232131
  });

  console.log("Error:", error);
  console.log("Data returned:", JSON.stringify(data, null, 2));
}
run().then(() => console.log("Done")).catch(console.error);
