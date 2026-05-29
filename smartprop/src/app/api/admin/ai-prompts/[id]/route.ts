import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/workers/supa';

/**
 * GET /api/admin/ai-prompts/[id]
 * Fetch a specific AI prompt by ID
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = getSupabaseClient();
    const { id } = await params;
    
    const { data: prompt, error } = await supabase
      .from('ai_prompts')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      throw error;
    }

    return NextResponse.json({ prompt });
  } catch (error) {
    console.error('Error fetching prompt:', error);
    return NextResponse.json(
      { error: 'Failed to fetch AI prompt' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/admin/ai-prompts/[id]
 * Update a specific AI prompt
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const body = await request.json();
    const { name, description, prompt_content, is_active } = body;
    const { id } = await params;

    const supabase = getSupabaseClient();

    // If activating this prompt, deactivate all others
    if (is_active) {
      await supabase
        .from('ai_prompts')
        .update({ is_active: false })
        .neq('id', id);
    }

    const { data: updatedPrompt, error } = await supabase
      .from('ai_prompts')
      .update({
        name,
        description,
        prompt_content,
        is_active,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw error;
    }

    return NextResponse.json({ prompt: updatedPrompt });
  } catch (error) {
    console.error('Error updating prompt:', error);
    return NextResponse.json(
      { error: 'Failed to update AI prompt' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/admin/ai-prompts/[id]
 * Delete a specific AI prompt
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = getSupabaseClient();
    const { id } = await params;
    
    const { error } = await supabase
      .from('ai_prompts')
      .delete()
      .eq('id', id);

    if (error) {
      throw error;
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting prompt:', error);
    return NextResponse.json(
      { error: 'Failed to delete AI prompt' },
      { status: 500 }
    );
  }
}
