import { getSupabaseClient } from './supa'

export interface AgentData {
  name: string
  phone: string
  email?: string
  agency?: string
  cea_reg_no?: string
  source: 'propertyguru' | 'edgeprop'
  source_url?: string
}

export interface ListingData {
  portal: 'propertyguru' | 'edgeprop'
  url: string
  title?: string
  price?: number
  district?: string
  property_type?: string
  posted_at?: string
  address?: string
  beds?: number
  baths?: number
  size_sqft?: number
  price_psf?: number
  year_built?: number
  tenure?: string
}

export interface UpsertData {
  agent: AgentData
  listing: ListingData
}

/**
 * Upserts agent and listing data with de-duplication
 * - Agents are de-duplicated by (source, phone) combination
 * - Listings are de-duplicated by URL
 * - Returns the agent ID and listing ID
 */
export async function upsertAgentAndListing(data: UpsertData): Promise<{
  agent_id: string
  listing_id: string
}> {
  const supabase = getSupabaseClient()
  
  try {
    // First, upsert the agent (de-duplicated by source + phone)
    const { data: agent, error: agentError } = await supabase
      .from('agents')
      .upsert(
        {
          ...data.agent,
          last_seen_at: new Date().toISOString(),
        },
        {
          onConflict: 'source,phone',
          ignoreDuplicates: false,
        }
      )
      .select('id')
      .single()

    if (agentError) {
      throw new Error(`Failed to upsert agent: ${agentError.message}`)
    }

    // Then, upsert the listing (de-duplicated by URL)
    const { data: listing, error: listingError } = await supabase
      .from('listings')
      .upsert(
        {
          ...data.listing,
          agent_id: agent.id,
          scraped_at: new Date().toISOString(),
        },
        {
          onConflict: 'url',
          ignoreDuplicates: false,
        }
      )
      .select('id')
      .single()

    if (listingError) {
      throw new Error(`Failed to upsert listing: ${listingError.message}`)
    }

    return {
      agent_id: agent.id,
      listing_id: listing.id,
    }
  } catch (error: unknown) {
    console.error('Error in upsertAgentAndListing:', error)
    throw error
  }
}

/**
 * Upserts only agent data (when listing data is not available)
 */
export async function upsertAgent(agentData: AgentData): Promise<string> {
  const supabase = getSupabaseClient()
  
  try {
    const { data: agent, error: agentError } = await supabase
      .from('agents')
      .upsert(
        {
          ...agentData,
          last_seen_at: new Date().toISOString(),
        },
        {
          onConflict: 'source,phone',
          ignoreDuplicates: false,
        }
      )
      .select('id')
      .single()

    if (agentError) {
      throw new Error(`Failed to upsert agent: ${agentError.message}`)
    }

    return agent.id
  } catch (error: unknown) {
    console.error('Error in upsertAgent:', error)
    throw error
  }
}

/**
 * Upserts only listing data (when agent data is not available)
 */
export async function upsertListing(listingData: ListingData): Promise<string> {
  const supabase = getSupabaseClient()
  
  try {
    const { data: listing, error: listingError } = await supabase
      .from('listings')
      .upsert(
        {
          ...listingData,
          scraped_at: new Date().toISOString(),
        },
        {
          onConflict: 'url',
          ignoreDuplicates: false,
        }
      )
      .select('id')
      .single()

    if (listingError) {
      throw new Error(`Failed to upsert listing: ${listingError.message}`)
    }

    return listing.id
  } catch (error: unknown) {
    console.error('Error in upsertListing:', error)
    throw error
  }
}
