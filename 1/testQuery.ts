import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });

const supabase = createClient(
    process.env.VITE_SUPABASE_URL || '',
    process.env.VITE_SUPABASE_ANON_KEY || ''
);

async function testQuery() {
    console.log("Testing with not.is.null");
    const res1 = await supabase
        .from('shifts')
        .select('id, bidding_status, assigned_employee_id')
        .or('bidding_status.in.(on_bidding_normal,on_bidding_urgent),assigned_employee_id.not.is.null')
        .limit(5);

    if (res1.error) {
        console.error('ERROR 1:', res1.error);
    } else {
        console.log('SUCCESS 1, count:', res1.data?.length);
    }

    console.log("Testing without not.is.null (just bidding_status)");
    const res2 = await supabase
        .from('shifts')
        .select('id, bidding_status, assigned_employee_id')
        .in('bidding_status', ['on_bidding_normal', 'on_bidding_urgent'])
        .limit(5);

    if (res2.error) {
        console.error('ERROR 2:', res2.error);
    } else {
        console.log('SUCCESS 2, count:', res2.data?.length);
    }
}

testQuery();
