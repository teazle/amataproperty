import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/workers/supa';

/**
 * GET /api/admin/ai-prompts
 * Fetch all AI prompts with versioning
 */
export async function GET() {
  try {
    const supabase = getSupabaseClient();
    
    const { data: prompts, error } = await supabase
      .from('ai_prompts')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      throw error;
    }

    return NextResponse.json({ prompts });
  } catch (error) {
    console.error('Error fetching prompts:', error);
    return NextResponse.json(
      { error: 'Failed to fetch AI prompts' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/ai-prompts
 * Create a new AI prompt
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, description, prompt_content, created_by = 'admin' } = body;

    if (!name || !prompt_content) {
      return NextResponse.json(
        { error: 'Name and prompt content are required' },
        { status: 400 }
      );
    }

    const supabase = getSupabaseClient();

    // Get the highest version number for this prompt name
    const { data: existingPrompts } = await supabase
      .from('ai_prompts')
      .select('version')
      .eq('name', name)
      .order('version', { ascending: false })
      .limit(1);

    const nextVersion = existingPrompts?.[0]?.version ? existingPrompts[0].version + 1 : 1;

    const { data: newPrompt, error } = await supabase
      .from('ai_prompts')
      .insert({
        name,
        description,
        prompt_content,
        version: nextVersion,
        created_by,
        is_active: false // New prompts are inactive by default
      })
      .select()
      .single();

    if (error) {
      throw error;
    }

    return NextResponse.json({ prompt: newPrompt });
  } catch (error) {
    console.error('Error creating prompt:', error);
    return NextResponse.json(
      { error: 'Failed to create AI prompt' },
      { status: 500 }
    );
  }
}
