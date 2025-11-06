import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_SERVICE_ROLE_KEY)!;

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase env not configured');
  return createClient(url, key);
}

interface UpdateListingRequest {
  // Listing details
  title?: string;
  price?: number;
  district?: string;
  property_type?: string;
  address?: string;
  beds?: number;
  baths?: number;
  size_sqft?: number;
  price_psf?: number;
  year_built?: number;
  tenure?: string;
  
  // Agent details
  agent_id?: string;
  agent_name?: string;
  agent_phone?: string;
  agent_email?: string;
  agent_agency?: string;
  agent_cea_reg_no?: string;
}

/**
 * PUT /api/listings/[id]
 * Update listing details and agent information
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = getSupabase();
    const { id } = await params;
    const listingId = id;
    const body: UpdateListingRequest = await request.json();

    if (!listingId) {
      return NextResponse.json(
        { error: 'Listing ID is required' },
        { status: 400 }
      );
    }

    // Start a transaction-like approach by updating both tables
    const updates: Partial<{
      title: string;
      price: number;
      district: string;
      property_type: string;
      address: string;
      beds: number;
      baths: number;
      size_sqft: number;
      price_psf: number;
      year_built: number;
      tenure: string;
      agent_id: string;
    }> = {};
    const agentUpdates: Partial<{
      name: string;
      phone: string;
      email: string;
      agency: string;
      cea_reg_no: string;
    }> = {};

    // Prepare listing updates
    if (body.title !== undefined) updates.title = body.title;
    if (body.price !== undefined) updates.price = body.price;
    if (body.district !== undefined) updates.district = body.district;
    if (body.property_type !== undefined) updates.property_type = body.property_type;
    if (body.address !== undefined) updates.address = body.address;
    if (body.beds !== undefined) updates.beds = body.beds;
    if (body.baths !== undefined) updates.baths = body.baths;
    if (body.size_sqft !== undefined) updates.size_sqft = body.size_sqft;
    if (body.price_psf !== undefined) updates.price_psf = body.price_psf;
    if (body.year_built !== undefined) updates.year_built = body.year_built;
    if (body.tenure !== undefined) updates.tenure = body.tenure;

    // Prepare agent updates
    if (body.agent_name !== undefined && body.agent_name !== '') agentUpdates.name = body.agent_name;
    if (body.agent_phone !== undefined && body.agent_phone !== '') agentUpdates.phone = body.agent_phone;
    if (body.agent_email !== undefined && body.agent_email !== '') agentUpdates.email = body.agent_email;
    if (body.agent_agency !== undefined && body.agent_agency !== '') agentUpdates.agency = body.agent_agency;
    if (body.agent_cea_reg_no !== undefined && body.agent_cea_reg_no !== '') agentUpdates.cea_reg_no = body.agent_cea_reg_no;
    
    console.log('Agent updates prepared:', agentUpdates);
    console.log('Body received:', body);

    // First, get the current listing to find the agent_id
    const { data: currentListing, error: fetchError } = await supabase
      .from('listings')
      .select('agent_id')
      .eq('id', listingId)
      .single();

    if (fetchError) {
      console.error('Error fetching current listing:', fetchError);
      return NextResponse.json(
        { error: 'Listing not found' },
        { status: 404 }
      );
    }

    let agentId = currentListing.agent_id;

    // Update agent if agent details are provided
    if (Object.keys(agentUpdates).length > 0) {
      console.log('Updating agent with data:', agentUpdates);
      console.log('Current agent ID:', agentId);
      
      if (agentId) {
        // Update existing agent
        const { data: updatedAgent, error: agentError } = await supabase
          .from('agents')
          .update(agentUpdates)
          .eq('id', agentId)
          .select()
          .single();

        if (agentError) {
          console.error('Error updating agent:', agentError);
          return NextResponse.json(
            { error: 'Failed to update agent', details: agentError.message },
            { status: 500 }
          );
        }
        console.log('Agent updated successfully:', updatedAgent);
      } else if (body.agent_name && body.agent_phone) {
        // Create new agent if no existing agent
        const { data: newAgent, error: createAgentError } = await supabase
          .from('agents')
          .insert({
            name: body.agent_name,
            phone: body.agent_phone,
            email: body.agent_email,
            agency: body.agent_agency,
            cea_reg_no: body.agent_cea_reg_no,
            source: 'propertyguru', // Use default source for manually created agents
            last_seen_at: new Date().toISOString()
          })
          .select()
          .single();

        if (createAgentError) {
          console.error('Error creating agent:', createAgentError);
          return NextResponse.json(
            { error: 'Failed to create agent' },
            { status: 500 }
          );
        }

        agentId = newAgent.id;
        updates.agent_id = agentId;
      }
    }

    // Update listing
    if (Object.keys(updates).length > 0) {
      console.log('Updating listing with data:', updates);
      
      const { data: updatedListings, error: listingError } = await supabase
        .from('listings')
        .update(updates)
        .eq('id', listingId)
        .select(`
          id,
          portal,
          url,
          title,
          price,
          district,
          property_type,
          agent_id,
          posted_at,
          scraped_at,
          address,
          beds,
          baths,
          size_sqft,
          price_psf,
          year_built,
          tenure,
          viewing_requested_at,
          viewing_timeslots,
          viewing_status,
          viewing_timeslots_structured,
          agents!left(
            id,
            name,
            phone,
            email,
            agency,
            cea_reg_no,
            source,
            source_url,
            last_seen_at
          )
        `);

      if (listingError) {
        console.error('Error updating listing:', listingError);
        return NextResponse.json(
          { error: 'Failed to update listing', details: listingError.message },
          { status: 500 }
        );
      }

      if (!updatedListings || updatedListings.length === 0) {
        return NextResponse.json(
          { error: 'Listing not found or not updated' },
          { status: 404 }
        );
      }

      const updatedListing = updatedListings[0];

      return NextResponse.json({
        success: true,
        listing: updatedListing
      });
    }

    return NextResponse.json({
      success: true,
      message: 'No updates provided'
    });

  } catch (error: unknown) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/listings/[id]
 * Get a specific listing by ID
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = getSupabase();
    const { id } = await params;
    const listingId = id;

    if (!listingId) {
      return NextResponse.json(
        { error: 'Listing ID is required' },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from('listings')
      .select(`
        id,
        portal,
        url,
        title,
        price,
        district,
        property_type,
        agent_id,
        posted_at,
        scraped_at,
        address,
        beds,
        baths,
        size_sqft,
        price_psf,
        year_built,
        tenure,
        viewing_requested_at,
        viewing_timeslots,
        viewing_status,
        viewing_timeslots_structured,
        agents!left(
          id,
          name,
          phone,
          email,
          agency,
          cea_reg_no,
          source,
          source_url,
          last_seen_at
        )
      `)
      .eq('id', listingId)
      .single();

    if (error) {
      console.error('Error fetching listing:', error);
      return NextResponse.json(
        { error: 'Listing not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ listing: data });

  } catch (error: unknown) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/listings/[id]
 * Delete a listing by ID
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = getSupabase();
    const { id } = await params;
    const listingId = id;

    if (!listingId) {
      return NextResponse.json(
        { error: 'Listing ID is required' },
        { status: 400 }
      );
    }

    // First, get the listing to check if it exists
    const { data: listing, error: fetchError } = await supabase
      .from('listings')
      .select('id, title')
      .eq('id', listingId)
      .single();

    if (fetchError || !listing) {
      console.error('Error fetching listing:', fetchError);
      return NextResponse.json(
        { error: 'Listing not found' },
        { status: 404 }
      );
    }

    // Delete the listing
    const { error: deleteError } = await supabase
      .from('listings')
      .delete()
      .eq('id', listingId);

    if (deleteError) {
      console.error('Error deleting listing:', deleteError);
      return NextResponse.json(
        { error: 'Failed to delete listing', details: deleteError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: `Listing "${listing.title}" deleted successfully`
    });

  } catch (error: unknown) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
